package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/go-redis/redis/v8"
	"github.com/gorilla/websocket"
	"github.com/nats-io/nats.go"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
	"gopkg.in/yaml.v3"
)

type Config struct {
	Server struct {
		Port string `yaml:"port"`
		Host string `yaml:"host"`
	} `yaml:"server"`
	WebSocket struct {
		Port           string `yaml:"port"`
		Path           string `yaml:"path"`
		ReadBufferSize int    `yaml:"read_buffer_size"`
		WriteBufferSize int   `yaml:"write_buffer_size"`
	} `yaml:"websocket"`
	MongoDB struct {
		URI      string `yaml:"uri"`
		Database string `yaml:"database"`
	} `yaml:"mongodb"`
	Valkey struct {
		Host     string        `yaml:"host"`
		Port     int           `yaml:"port"`
		Password string        `yaml:"password"`
		DB       int           `yaml:"db"`
		PoolSize int           `yaml:"pool_size"`
		TTL      time.Duration `yaml:"ttl"`
	} `yaml:"valkey"`
	NATS struct {
		URL           string        `yaml:"url"`
		InputSubject  string        `yaml:"input_subject"`
		OutputSubject string        `yaml:"output_subject"`
		MaxReconnect  int           `yaml:"max_reconnect"`
		ReconnectWait time.Duration `yaml:"reconnect_wait"`
	} `yaml:"nats"`
	Collections map[string]CollectionConfig `yaml:"collections"`
	Batching    struct {
		Enabled       bool          `yaml:"enabled"`
		MaxBatchSize  int           `yaml:"max_batch_size"`
		FlushInterval time.Duration `yaml:"flush_interval"`
		MaxWaitTime   time.Duration `yaml:"max_wait_time"`
	} `yaml:"batching"`
	Logging struct {
		Level  string `yaml:"level"`
		Format string `yaml:"format"`
	} `yaml:"logging"`
	Health struct {
		Enabled bool   `yaml:"enabled"`
		Port    string `yaml:"port"`
	} `yaml:"health"`
}

type CollectionConfig struct {
	EnableAggregation  bool          `yaml:"enable_aggregation"`
	FetchFullDocument bool          `yaml:"fetch_full_document"`
	ProjectFields     []string      `yaml:"project_fields"`
	CacheUserNames    bool          `yaml:"cache_user_names"`
	CacheMetadata     bool          `yaml:"cache_metadata"`
	CacheTTL          time.Duration `yaml:"cache_ttl"`
	EnrichFields      []string      `yaml:"enrich_fields"`
}

type ChangeEvent struct {
	Collection    string                 `json:"collection"`
	Action        string                 `json:"action"`
	ClientAction  string                 `json:"clientAction"`
	ID            interface{}            `json:"id"`
	Data          map[string]interface{} `json:"data,omitempty"`
	Diff          map[string]interface{} `json:"diff,omitempty"`
	Unset         map[string]interface{} `json:"unset,omitempty"`
	Timestamp     int64                  `json:"timestamp"`
	OperationType string                 `json:"operationType"`
}

type AggregatedEvent struct {
	*ChangeEvent
	Enriched  bool   `json:"enriched"`
	ProcessedAt int64 `json:"processedAt"`
}

type EventBatch struct {
	events []ChangeEvent
	timer  *time.Timer
	mutex  sync.Mutex
}

type WebSocketAggregator struct {
	config         *Config
	mongoClient    *mongo.Client
	redisClient    *redis.Client
	natsConn       *nats.Conn
	subscription   *nats.Subscription
	ctx            context.Context
	cancel         context.CancelFunc
	wg             sync.WaitGroup
	eventBatch     *EventBatch
	upgrader       websocket.Upgrader
	wsClients      map[*websocket.Conn]bool
	wsClientsMutex sync.RWMutex
	eventsProcessed int64
	startTime      time.Time
}

func NewWebSocketAggregator() *WebSocketAggregator {
	ctx, cancel := context.WithCancel(context.Background())
	return &WebSocketAggregator{
		ctx:       ctx,
		cancel:    cancel,
		wsClients: make(map[*websocket.Conn]bool),
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool {
				return true // Allow connections from any origin
			},
		},
		startTime: time.Now(),
	}
}

func (wsa *WebSocketAggregator) LoadConfig(configFile string) error {
	data, err := os.ReadFile(configFile)
	if err != nil {
		return fmt.Errorf("failed to read config file: %w", err)
	}

	wsa.config = &Config{}
	if err := yaml.Unmarshal(data, wsa.config); err != nil {
		return fmt.Errorf("failed to parse config: %w", err)
	}

	return nil
}

func (wsa *WebSocketAggregator) ConnectMongoDB() error {
	clientOptions := options.Client().ApplyURI(wsa.config.MongoDB.URI)
	
	client, err := mongo.Connect(wsa.ctx, clientOptions)
	if err != nil {
		return fmt.Errorf("failed to connect to MongoDB: %w", err)
	}

	if err := client.Ping(wsa.ctx, nil); err != nil {
		return fmt.Errorf("failed to ping MongoDB: %w", err)
	}

	wsa.mongoClient = client
	log.Printf("[AGGREGATOR] 🗄️ Connected to MongoDB: %s (database: %s)", wsa.config.MongoDB.URI, wsa.config.MongoDB.Database)
	return nil
}

func (wsa *WebSocketAggregator) ConnectValkey() error {
	wsa.redisClient = redis.NewClient(&redis.Options{
		Addr:     fmt.Sprintf("%s:%d", wsa.config.Valkey.Host, wsa.config.Valkey.Port),
		Password: wsa.config.Valkey.Password,
		DB:       wsa.config.Valkey.DB,
		PoolSize: wsa.config.Valkey.PoolSize,
	})

	// Test connection
	if err := wsa.redisClient.Ping(wsa.ctx).Err(); err != nil {
		return fmt.Errorf("failed to connect to Valkey: %w", err)
	}

	log.Printf("[AGGREGATOR] 🗄️ Connected to Valkey: %s:%d (DB: %d, Pool: %d)", 
		wsa.config.Valkey.Host, wsa.config.Valkey.Port, wsa.config.Valkey.DB, wsa.config.Valkey.PoolSize)
	return nil
}

func (wsa *WebSocketAggregator) ConnectNATS() error {
	nc, err := nats.Connect(
		wsa.config.NATS.URL,
		nats.MaxReconnects(wsa.config.NATS.MaxReconnect),
		nats.ReconnectWait(wsa.config.NATS.ReconnectWait),
		nats.DisconnectErrHandler(func(nc *nats.Conn, err error) {
			log.Printf("NATS disconnected: %v", err)
		}),
		nats.ReconnectHandler(func(nc *nats.Conn) {
			log.Printf("NATS reconnected to %s", nc.ConnectedUrl())
		}),
	)
	if err != nil {
		return fmt.Errorf("failed to connect to NATS: %w", err)
	}

	wsa.natsConn = nc
	log.Printf("[AGGREGATOR] 📡 Connected to NATS: %s (input: %s, output: %s)", 
		wsa.config.NATS.URL, wsa.config.NATS.InputSubject, wsa.config.NATS.OutputSubject)
	return nil
}

func (wsa *WebSocketAggregator) StartEventProcessing() error {
	// Initialize event batching if enabled
	if wsa.config.Batching.Enabled {
		wsa.eventBatch = &EventBatch{
			events: make([]ChangeEvent, 0, wsa.config.Batching.MaxBatchSize),
		}
	}

	// Subscribe to change events from DbWatcher
	sub, err := wsa.natsConn.Subscribe(wsa.config.NATS.InputSubject, wsa.handleChangeEvent)
	if err != nil {
		return fmt.Errorf("failed to subscribe to NATS subject: %w", err)
	}
	wsa.subscription = sub

	log.Printf("[AGGREGATOR] 📥 Subscribed to NATS input subject: %s (batching: %t)", 
		wsa.config.NATS.InputSubject, wsa.config.Batching.Enabled)
	return nil
}

func (wsa *WebSocketAggregator) handleChangeEvent(msg *nats.Msg) {
	var event ChangeEvent
	if err := json.Unmarshal(msg.Data, &event); err != nil {
		log.Printf("[AGGREGATOR] ❌ Failed to unmarshal event from NATS: %v", err)
		log.Printf("[AGGREGATOR] 📋 Raw message data: %s", string(msg.Data))
		return
	}

	// Always log received events
	log.Printf("[AGGREGATOR] 📨 Received from NATS [%s]: collection=%s, action=%s, id=%v", 
		msg.Subject, event.Collection, event.Action, event.ID)

	// Enhanced debug logging
	if wsa.config.Logging.Level == "debug" || wsa.config.Logging.Level == "trace" {
		log.Printf("[AGGREGATOR] 🔍 Event details: operationType=%s, timestamp=%d, hasData=%t, hasDiff=%t, hasUnset=%t, payload_size=%d bytes", 
			event.OperationType, event.Timestamp, event.Data != nil, event.Diff != nil, event.Unset != nil, len(msg.Data))
		
		if wsa.config.Logging.Level == "trace" {
			log.Printf("[AGGREGATOR] 📋 Raw event payload: %s", string(msg.Data))
		}
	}

	if wsa.config.Batching.Enabled {
		log.Printf("[AGGREGATOR] 📦 Adding to batch (batching enabled)")
		wsa.addEventToBatch(event)
	} else {
		log.Printf("[AGGREGATOR] ⚡ Processing immediately (batching disabled)")
		wsa.processEvent(event)
	}
}

func (wsa *WebSocketAggregator) addEventToBatch(event ChangeEvent) {
	wsa.eventBatch.mutex.Lock()
	defer wsa.eventBatch.mutex.Unlock()

	wsa.eventBatch.events = append(wsa.eventBatch.events, event)

	// Reset timer
	if wsa.eventBatch.timer != nil {
		wsa.eventBatch.timer.Stop()
	}
	
	wsa.eventBatch.timer = time.AfterFunc(wsa.config.Batching.FlushInterval, func() {
		wsa.flushBatch()
	})

	// Flush if batch is full
	if len(wsa.eventBatch.events) >= wsa.config.Batching.MaxBatchSize {
		if wsa.eventBatch.timer != nil {
			wsa.eventBatch.timer.Stop()
		}
		wsa.flushBatch()
	}
}

func (wsa *WebSocketAggregator) flushBatch() {
	wsa.eventBatch.mutex.Lock()
	events := make([]ChangeEvent, len(wsa.eventBatch.events))
	copy(events, wsa.eventBatch.events)
	wsa.eventBatch.events = wsa.eventBatch.events[:0] // Reset slice
	wsa.eventBatch.mutex.Unlock()

	for _, event := range events {
		wsa.processEvent(event)
	}
}

func (wsa *WebSocketAggregator) processEvent(event ChangeEvent) {
	collectionConfig, exists := wsa.config.Collections[event.Collection]
	if !exists || !collectionConfig.EnableAggregation {
		// Pass through without aggregation
		wsa.publishAggregatedEvent(&AggregatedEvent{
			ChangeEvent: &event,
			Enriched:    false,
			ProcessedAt: time.Now().UnixMilli(),
		})
		return
	}

	// Perform aggregation based on collection config
	aggregatedEvent := wsa.aggregateEvent(event, collectionConfig)
	wsa.publishAggregatedEvent(aggregatedEvent)
}

func (wsa *WebSocketAggregator) aggregateEvent(event ChangeEvent, config CollectionConfig) *AggregatedEvent {
	aggregated := &AggregatedEvent{
		ChangeEvent: &event,
		Enriched:    false,
		ProcessedAt: time.Now().UnixMilli(),
	}

	switch event.Collection {
	case "messages":
		wsa.aggregateMessageEvent(aggregated, config)
	case "subscriptions":
		wsa.aggregateSubscriptionEvent(aggregated, config)
	case "rooms":
		wsa.aggregateRoomEvent(aggregated, config)
	default:
		// Default processing for other collections
		if config.FetchFullDocument && event.Data == nil {
			wsa.fetchFullDocument(aggregated, config)
		}
	}

	return aggregated
}

func (wsa *WebSocketAggregator) aggregateMessageEvent(event *AggregatedEvent, config CollectionConfig) {
	if config.CacheUserNames && event.Data != nil {
		// Enrich user information
		if userInfo, ok := event.Data["u"].(map[string]interface{}); ok {
			if userID, ok := userInfo["_id"].(string); ok {
				if userName := wsa.getCachedUserName(userID); userName != "" {
					userInfo["name"] = userName
					event.Enriched = true
				}
			}
		}

		// Enrich mentions
		if mentions, ok := event.Data["mentions"].([]interface{}); ok {
			enriched := false
			for _, mention := range mentions {
				if mentionMap, ok := mention.(map[string]interface{}); ok {
					if userID, ok := mentionMap["_id"].(string); ok {
						if userName := wsa.getCachedUserName(userID); userName != "" {
							mentionMap["name"] = userName
							enriched = true
						}
					}
				}
			}
			if enriched {
				event.Enriched = true
			}
		}
	}
}

func (wsa *WebSocketAggregator) aggregateSubscriptionEvent(event *AggregatedEvent, config CollectionConfig) {
	if config.FetchFullDocument && (len(event.Data) == 0) {
		// Fetch full subscription document
		wsa.fetchFullDocument(event, config)
	}

	// Project only required fields if specified
	if len(config.ProjectFields) > 0 && event.Data != nil {
		projectedData := make(map[string]interface{})
		for _, field := range config.ProjectFields {
			if value, exists := event.Data[field]; exists {
				projectedData[field] = value
			}
		}
		event.Data = projectedData
		event.Enriched = true
	}
}

func (wsa *WebSocketAggregator) aggregateRoomEvent(event *AggregatedEvent, config CollectionConfig) {
	if config.CacheMetadata {
		// Cache room metadata for future use
		if event.Data != nil {
			cacheKey := fmt.Sprintf("room:%v", event.ID)
			jsonData, _ := json.Marshal(event.Data)
			wsa.redisClient.Set(wsa.ctx, cacheKey, jsonData, config.CacheTTL)
		}
	}
}

func (wsa *WebSocketAggregator) fetchFullDocument(event *AggregatedEvent, config CollectionConfig) {
	if wsa.mongoClient == nil {
		return
	}

	collection := wsa.mongoClient.Database(wsa.config.MongoDB.Database).Collection(event.Collection)
	
	// Convert ID to appropriate type
	var filter bson.M
	if idStr, ok := event.ID.(string); ok {
		if objectID, err := primitive.ObjectIDFromHex(idStr); err == nil {
			filter = bson.M{"_id": objectID}
		} else {
			filter = bson.M{"_id": idStr}
		}
	} else {
		filter = bson.M{"_id": event.ID}
	}

	var result bson.M
	opts := options.FindOne()
	if len(config.ProjectFields) > 0 {
		projection := bson.M{}
		for _, field := range config.ProjectFields {
			projection[field] = 1
		}
		opts.SetProjection(projection)
	}

	err := collection.FindOne(wsa.ctx, filter, opts).Decode(&result)
	if err != nil {
		log.Printf("[AGGREGATOR] ⚠️ Failed to fetch full document for %s:%v: %v", event.Collection, event.ID, err)
		return
	}

	if wsa.config.Logging.Level == "trace" {
		log.Printf("[AGGREGATOR] 📄 Fetched full document for %s:%v (%d fields)", 
			event.Collection, event.ID, len(result))
	}

	// Convert bson.M to map[string]interface{}
	event.Data = make(map[string]interface{})
	for k, v := range result {
		event.Data[k] = v
	}
	event.Enriched = true
}

func (wsa *WebSocketAggregator) getCachedUserName(userID string) string {
	cacheKey := fmt.Sprintf("user:name:%s", userID)
	
	// Try cache first
	cachedName, err := wsa.redisClient.Get(wsa.ctx, cacheKey).Result()
	if err == nil {
		return cachedName
	}

	// Fetch from database
	collection := wsa.mongoClient.Database(wsa.config.MongoDB.Database).Collection("users")
	var user bson.M
	
	objectID, err := primitive.ObjectIDFromHex(userID)
	if err != nil {
		return ""
	}

	err = collection.FindOne(wsa.ctx, bson.M{"_id": objectID}, options.FindOne().SetProjection(bson.M{"name": 1})).Decode(&user)
	if err != nil {
		return ""
	}

	if name, ok := user["name"].(string); ok {
		// Cache for future use
		wsa.redisClient.Set(wsa.ctx, cacheKey, name, wsa.config.Valkey.TTL)
		return name
	}

	return ""
}

func (wsa *WebSocketAggregator) publishAggregatedEvent(event *AggregatedEvent) {
	eventJSON, err := json.Marshal(event)
	if err != nil {
		log.Printf("[AGGREGATOR] ❌ Failed to marshal aggregated event: %v", err)
		return
	}

	// Always log publishing
	log.Printf("[AGGREGATOR] 📤 Publishing to NATS [%s]: collection=%s, action=%s, id=%v, enriched=%t", 
		wsa.config.NATS.OutputSubject, event.Collection, event.Action, event.ID, event.Enriched)

	// Publish to NATS for Rocket.Chat consumption
	if err := wsa.natsConn.Publish(wsa.config.NATS.OutputSubject, eventJSON); err != nil {
		log.Printf("[AGGREGATOR] ❌ Failed to publish aggregated event to NATS: %v", err)
		return
	}

	log.Printf("[AGGREGATOR] ✅ Published to NATS successfully!")

	// Also send to WebSocket clients for real-time monitoring
	wsa.wsClientsMutex.RLock()
	clientCount := len(wsa.wsClients)
	wsa.wsClientsMutex.RUnlock()
	
	if clientCount > 0 {
		log.Printf("[AGGREGATOR] 🌐 Broadcasting to %d WebSocket clients", clientCount)
		wsa.broadcastToWebSocketClients(eventJSON)
	}

	wsa.eventsProcessed++
	log.Printf("[AGGREGATOR] 📊 Total events processed: %d", wsa.eventsProcessed)
	
	// Enhanced debug logging
	if wsa.config.Logging.Level == "debug" || wsa.config.Logging.Level == "trace" {
		log.Printf("[AGGREGATOR] 🔍 Event processing details: processedAt=%d, uptime=%.1fs, payload_size=%d bytes", 
			event.ProcessedAt, time.Since(wsa.startTime).Seconds(), len(eventJSON))
		
		if wsa.config.Logging.Level == "trace" {
			log.Printf("[AGGREGATOR] 📋 Aggregated event payload: %s", string(eventJSON))
		}
	}
}

func (wsa *WebSocketAggregator) broadcastToWebSocketClients(data []byte) {
	wsa.wsClientsMutex.RLock()
	clients := make([]*websocket.Conn, 0, len(wsa.wsClients))
	for client := range wsa.wsClients {
		clients = append(clients, client)
	}
	wsa.wsClientsMutex.RUnlock()

	for _, client := range clients {
		err := client.WriteMessage(websocket.TextMessage, data)
		if err != nil {
			// Remove disconnected client
			wsa.wsClientsMutex.Lock()
			delete(wsa.wsClients, client)
			client.Close()
			wsa.wsClientsMutex.Unlock()
		}
	}
}

func (wsa *WebSocketAggregator) startWebSocketServer() {
	http.HandleFunc(wsa.config.WebSocket.Path, wsa.handleWebSocketConnection)
	
	wsa.upgrader.ReadBufferSize = wsa.config.WebSocket.ReadBufferSize
	wsa.upgrader.WriteBufferSize = wsa.config.WebSocket.WriteBufferSize

	server := &http.Server{
		Addr: fmt.Sprintf("%s:%s", wsa.config.Server.Host, wsa.config.WebSocket.Port),
	}

	go func() {
		log.Printf("[AGGREGATOR] 🌐 WebSocket server started on port %s%s (read buffer: %d, write buffer: %d)", 
			wsa.config.WebSocket.Port, wsa.config.WebSocket.Path, 
			wsa.config.WebSocket.ReadBufferSize, wsa.config.WebSocket.WriteBufferSize)
		if err := server.ListenAndServe(); err != http.ErrServerClosed {
			log.Printf("WebSocket server error: %v", err)
		}
	}()
}

func (wsa *WebSocketAggregator) handleWebSocketConnection(w http.ResponseWriter, r *http.Request) {
	conn, err := wsa.upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade error: %v", err)
		return
	}

	wsa.wsClientsMutex.Lock()
	wsa.wsClients[conn] = true
	wsa.wsClientsMutex.Unlock()

	log.Printf("[AGGREGATOR] 🔗 New WebSocket client connected from %s. Total clients: %d", r.RemoteAddr, len(wsa.wsClients))

	// Handle client disconnection
	defer func() {
		wsa.wsClientsMutex.Lock()
		delete(wsa.wsClients, conn)
		wsa.wsClientsMutex.Unlock()
		conn.Close()
		log.Printf("[AGGREGATOR] 🔌 WebSocket client disconnected. Total clients: %d", len(wsa.wsClients))
	}()

	// Keep connection alive and handle messages
	for {
		_, _, err := conn.ReadMessage()
		if err != nil {
			break
		}
	}
}

func (wsa *WebSocketAggregator) startHealthServer() {
	if !wsa.config.Health.Enabled {
		return
	}

	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		wsa.wsClientsMutex.RLock()
		clientCount := len(wsa.wsClients)
		wsa.wsClientsMutex.RUnlock()

		status := map[string]interface{}{
			"status":            "healthy",
			"uptime":            time.Since(wsa.startTime).Seconds(),
			"events_processed":  wsa.eventsProcessed,
			"websocket_clients": clientCount,
			"mongodb_connected": wsa.mongoClient != nil,
			"valkey_connected":  wsa.redisClient != nil,
			"nats_connected":    wsa.natsConn != nil && wsa.natsConn.IsConnected(),
			"timestamp":         time.Now().UnixMilli(),
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(status)
	})

	http.HandleFunc("/metrics", func(w http.ResponseWriter, r *http.Request) {
		wsa.wsClientsMutex.RLock()
		clientCount := len(wsa.wsClients)
		wsa.wsClientsMutex.RUnlock()

		metrics := map[string]interface{}{
			"events_processed":   wsa.eventsProcessed,
			"uptime_seconds":     time.Since(wsa.startTime).Seconds(),
			"websocket_clients":  clientCount,
			"mongodb_connected":  wsa.mongoClient != nil,
			"valkey_connected":   wsa.redisClient != nil,
			"nats_connected":     wsa.natsConn != nil && wsa.natsConn.IsConnected(),
			"start_time":         wsa.startTime.Unix(),
			"current_time":       time.Now().Unix(),
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(metrics)
	})

	server := &http.Server{
		Addr: fmt.Sprintf("%s:%s", wsa.config.Server.Host, wsa.config.Health.Port),
	}

	go func() {
		log.Printf("[AGGREGATOR] 🏥 Health server started on port %s", wsa.config.Health.Port)
		if err := server.ListenAndServe(); err != http.ErrServerClosed {
			log.Printf("Health server error: %v", err)
		}
	}()
}

func (wsa *WebSocketAggregator) Shutdown() error {
	log.Println("Shutting down WebSocket Aggregator...")
	
	wsa.cancel()
	
	// Close NATS subscription
	if wsa.subscription != nil {
		wsa.subscription.Unsubscribe()
	}
	
	// Close all WebSocket connections
	wsa.wsClientsMutex.Lock()
	for client := range wsa.wsClients {
		client.Close()
	}
	wsa.wsClients = make(map[*websocket.Conn]bool)
	wsa.wsClientsMutex.Unlock()
	
	// Wait for goroutines to finish
	wsa.wg.Wait()
	
	// Close connections
	if wsa.mongoClient != nil {
		wsa.mongoClient.Disconnect(context.Background())
	}
	if wsa.redisClient != nil {
		wsa.redisClient.Close()
	}
	if wsa.natsConn != nil {
		wsa.natsConn.Close()
	}
	
	log.Println("WebSocket Aggregator shutdown complete")
	return nil
}

func main() {
	configFile := "config.yaml"
	if len(os.Args) > 1 {
		configFile = os.Args[1]
	}

	wsa := NewWebSocketAggregator()
	
	// Load configuration
	if err := wsa.LoadConfig(configFile); err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}
	
	// Connect to services
	if err := wsa.ConnectMongoDB(); err != nil {
		log.Fatalf("MongoDB connection failed: %v", err)
	}
	
	if err := wsa.ConnectValkey(); err != nil {
		log.Fatalf("Valkey connection failed: %v", err)
	}
	
	if err := wsa.ConnectNATS(); err != nil {
		log.Fatalf("NATS connection failed: %v", err)
	}
	
	// Start servers
	wsa.startHealthServer()
	wsa.startWebSocketServer()
	
	// Start event processing
	if err := wsa.StartEventProcessing(); err != nil {
		log.Fatalf("Failed to start event processing: %v", err)
	}
	
	log.Println("WebSocket Aggregator started successfully")
	
	// Wait for interrupt signal
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	<-sigChan
	
	// Graceful shutdown
	wsa.Shutdown()
}