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

	"github.com/nats-io/nats.go"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
	"gopkg.in/yaml.v3"
)

type Config struct {
	Server struct {
		Port string `yaml:"port"`
		Host string `yaml:"host"`
	} `yaml:"server"`
	MongoDB struct {
		URI      string `yaml:"uri"`
		Database string `yaml:"database"`
	} `yaml:"mongodb"`
	NATS struct {
		URL           string        `yaml:"url"`
		Subject       string        `yaml:"subject"`
		MaxReconnect  int           `yaml:"max_reconnect"`
		ReconnectWait time.Duration `yaml:"reconnect_wait"`
	} `yaml:"nats"`
	Collections map[string]CollectionConfig `yaml:"collections"`
	Logging     struct {
		Level  string `yaml:"level"`
		Format string `yaml:"format"`
	} `yaml:"logging"`
	Health struct {
		Enabled bool   `yaml:"enabled"`
		Port    string `yaml:"port"`
	} `yaml:"health"`
}

type CollectionConfig struct {
	Enabled      bool     `yaml:"enabled"`
	FullDocument bool     `yaml:"full_document"`
	Fields       []string `yaml:"fields"`
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

type DbWatcher struct {
	config         *Config
	mongoClient    *mongo.Client
	natsConn       *nats.Conn
	watchers       map[string]*mongo.ChangeStream
	ctx            context.Context
	cancel         context.CancelFunc
	wg             sync.WaitGroup
	eventsCounter  int64
	startTime      time.Time
}

func NewDbWatcher() *DbWatcher {
	ctx, cancel := context.WithCancel(context.Background())
	return &DbWatcher{
		watchers:  make(map[string]*mongo.ChangeStream),
		ctx:       ctx,
		cancel:    cancel,
		startTime: time.Now(),
	}
}

func (dw *DbWatcher) LoadConfig(configFile string) error {
	data, err := os.ReadFile(configFile)
	if err != nil {
		return fmt.Errorf("failed to read config file: %w", err)
	}

	dw.config = &Config{}
	if err := yaml.Unmarshal(data, dw.config); err != nil {
		return fmt.Errorf("failed to parse config: %w", err)
	}

	return nil
}

func (dw *DbWatcher) ConnectMongoDB() error {
	clientOptions := options.Client().ApplyURI(dw.config.MongoDB.URI)
	
	client, err := mongo.Connect(dw.ctx, clientOptions)
	if err != nil {
		return fmt.Errorf("failed to connect to MongoDB: %w", err)
	}

	// Ping the database
	if err := client.Ping(dw.ctx, nil); err != nil {
		return fmt.Errorf("failed to ping MongoDB: %w", err)
	}

	dw.mongoClient = client
	log.Printf("[DBWATCHER] 🗄️ Connected to MongoDB: %s (database: %s)", dw.config.MongoDB.URI, dw.config.MongoDB.Database)
	return nil
}

func (dw *DbWatcher) ConnectNATS() error {
	nc, err := nats.Connect(
		dw.config.NATS.URL,
		nats.MaxReconnects(dw.config.NATS.MaxReconnect),
		nats.ReconnectWait(dw.config.NATS.ReconnectWait),
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

	dw.natsConn = nc
	log.Printf("[DBWATCHER] 📡 Connected to NATS: %s (subject: %s)", dw.config.NATS.URL, dw.config.NATS.Subject)
	return nil
}

func (dw *DbWatcher) StartWatching() error {
	db := dw.mongoClient.Database(dw.config.MongoDB.Database)
	
	for collectionName, collConfig := range dw.config.Collections {
		if !collConfig.Enabled {
			continue
		}
		
		dw.wg.Add(1)
		go dw.watchCollection(db, collectionName, collConfig)
		log.Printf("[DBWATCHER] 👀 Started watching collection: %s (fullDocument: %t, fields: %v)", 
			collectionName, collConfig.FullDocument, collConfig.Fields)
	}

	return nil
}

func (dw *DbWatcher) watchCollection(db *mongo.Database, collectionName string, config CollectionConfig) {
	defer dw.wg.Done()

	collection := db.Collection(collectionName)
	
	// Configure change stream options
	opts := options.ChangeStream()
	if config.FullDocument {
		opts.SetFullDocument(options.UpdateLookup)
	}

	log.Printf("[DBWATCHER] 🚀 Starting change stream for collection: %s", collectionName)
	
	// Start change stream
	changeStream, err := collection.Watch(dw.ctx, mongo.Pipeline{}, opts)
	if err != nil {
		log.Printf("[DBWATCHER] ❌ Failed to start change stream for %s: %v", collectionName, err)
		return
	}
	defer changeStream.Close(dw.ctx)

	dw.watchers[collectionName] = changeStream
	log.Printf("[DBWATCHER] 🎧 Change stream active for collection: %s", collectionName)

	for changeStream.Next(dw.ctx) {
		var changeDoc bson.M
		if err := changeStream.Decode(&changeDoc); err != nil {
			log.Printf("[DBWATCHER] ❌ Failed to decode change for %s: %v", collectionName, err)
			continue
		}

		// Enhanced debug logging for raw change events
		if dw.config.Logging.Level == "debug" || dw.config.Logging.Level == "trace" {
			log.Printf("[DBWATCHER] 🔍 Raw change detected in %s: operationType=%v", 
				collectionName, changeDoc["operationType"])
		}
		
		if dw.config.Logging.Level == "trace" {
			if changeData, err := json.Marshal(changeDoc); err == nil {
				log.Printf("[DBWATCHER] 📋 Raw change data for %s: %s", collectionName, string(changeData))
			}
		}

		event := dw.processChange(collectionName, changeDoc, config)
		if event != nil {
			dw.publishEvent(event)
		} else {
			log.Printf("[DBWATCHER] ⚠️ Change ignored for %s (unsupported operation or error)", collectionName)
		}
	}

	if err := changeStream.Err(); err != nil {
		log.Printf("[DBWATCHER] ❌ Change stream error for %s: %v", collectionName, err)
	}
	
	log.Printf("[DBWATCHER] 🛑 Change stream ended for collection: %s", collectionName)
}

func (dw *DbWatcher) processChange(collectionName string, changeDoc bson.M, config CollectionConfig) *ChangeEvent {
	operationType, ok := changeDoc["operationType"].(string)
	if !ok {
		return nil
	}

	// Map MongoDB operation types to Rocket.Chat actions
	var action, clientAction string
	switch operationType {
	case "insert":
		action = "insert"
		clientAction = "inserted"
	case "update", "replace":
		action = "update"
		clientAction = "updated"
	case "delete":
		action = "remove"
		clientAction = "removed"
	default:
		return nil // Skip unsupported operations
	}

	event := &ChangeEvent{
		Collection:    collectionName,
		Action:        action,
		ClientAction:  clientAction,
		OperationType: operationType,
		Timestamp:     time.Now().UnixMilli(),
	}

	// Extract document ID
	if documentKey, ok := changeDoc["documentKey"].(bson.M); ok {
		if id, ok := documentKey["_id"]; ok {
			event.ID = id
		}
	}

	// Process full document
	if fullDocument, ok := changeDoc["fullDocument"].(bson.M); ok && config.FullDocument {
		event.Data = make(map[string]interface{})
		
		if len(config.Fields) == 0 {
			// Include all fields
			for k, v := range fullDocument {
				event.Data[k] = v
			}
		} else {
			// Include only specified fields
			for _, field := range config.Fields {
				if value, exists := fullDocument[field]; exists {
					event.Data[field] = value
				}
			}
		}
	}

	// Process update description for partial updates
	if updateDescription, ok := changeDoc["updateDescription"].(bson.M); ok {
		if updatedFields, ok := updateDescription["updatedFields"].(bson.M); ok {
			event.Diff = make(map[string]interface{})
			for k, v := range updatedFields {
				event.Diff[k] = v
			}
		}
		if removedFields, ok := updateDescription["removedFields"].(bson.A); ok {
			event.Unset = make(map[string]interface{})
			for _, field := range removedFields {
				if fieldStr, ok := field.(string); ok {
					event.Unset[fieldStr] = 1
				}
			}
		}
	}

	return event
}

func (dw *DbWatcher) publishEvent(event *ChangeEvent) {
	eventJSON, err := json.Marshal(event)
	if err != nil {
		log.Printf("[DBWATCHER] ❌ Failed to marshal event: %v", err)
		return
	}

	// Always log event publishing
	log.Printf("[DBWATCHER] 📤 Publishing to NATS [%s]: collection=%s, action=%s, id=%v", 
		dw.config.NATS.Subject, event.Collection, event.Action, event.ID)

	if err := dw.natsConn.Publish(dw.config.NATS.Subject, eventJSON); err != nil {
		log.Printf("[DBWATCHER] ❌ Failed to publish event to NATS: %v", err)
		return
	}

	dw.eventsCounter++
	log.Printf("[DBWATCHER] ✅ Event published successfully! Total events: %d", dw.eventsCounter)
	
	// Enhanced debug logging
	if dw.config.Logging.Level == "debug" || dw.config.Logging.Level == "trace" {
		log.Printf("[DBWATCHER] 🔍 Event details: operationType=%s, clientAction=%s, hasData=%t, hasDiff=%t, payload_size=%d bytes", 
			event.OperationType, event.ClientAction, event.Data != nil, event.Diff != nil, len(eventJSON))
		
		if dw.config.Logging.Level == "trace" {
			log.Printf("[DBWATCHER] 📋 Full event payload: %s", string(eventJSON))
		}
	}
}

func (dw *DbWatcher) startHealthServer() {
	if !dw.config.Health.Enabled {
		return
	}

	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		status := map[string]interface{}{
			"status":         "healthy",
			"uptime":         time.Since(dw.startTime).Seconds(),
			"events_published": dw.eventsCounter,
			"mongodb_connected": dw.mongoClient != nil,
			"nats_connected":    dw.natsConn != nil && dw.natsConn.IsConnected(),
			"watching_collections": len(dw.watchers),
			"timestamp":      time.Now().UnixMilli(),
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(status)
	})

	http.HandleFunc("/metrics", func(w http.ResponseWriter, r *http.Request) {
		metrics := map[string]interface{}{
			"events_published":     dw.eventsCounter,
			"uptime_seconds":       time.Since(dw.startTime).Seconds(),
			"collections_watched":  len(dw.watchers),
			"mongodb_connected":    dw.mongoClient != nil,
			"nats_connected":       dw.natsConn != nil && dw.natsConn.IsConnected(),
			"start_time":           dw.startTime.Unix(),
			"current_time":         time.Now().Unix(),
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(metrics)
	})

	server := &http.Server{
		Addr: fmt.Sprintf("%s:%s", dw.config.Server.Host, dw.config.Health.Port),
	}

	go func() {
		log.Printf("Health server started on port %s", dw.config.Health.Port)
		if err := server.ListenAndServe(); err != http.ErrServerClosed {
			log.Printf("Health server error: %v", err)
		}
	}()
}

func (dw *DbWatcher) Shutdown() error {
	log.Println("Shutting down DbWatcher...")
	
	dw.cancel()
	
	// Close change streams
	for name, watcher := range dw.watchers {
		if watcher != nil {
			watcher.Close(context.Background())
			log.Printf("Closed watcher for %s", name)
		}
	}
	
	// Wait for all goroutines to finish
	dw.wg.Wait()
	
	// Close connections
	if dw.mongoClient != nil {
		dw.mongoClient.Disconnect(context.Background())
	}
	if dw.natsConn != nil {
		dw.natsConn.Close()
	}
	
	log.Println("DbWatcher shutdown complete")
	return nil
}

func main() {
	configFile := "config.yaml"
	if len(os.Args) > 1 {
		configFile = os.Args[1]
	}

	dw := NewDbWatcher()
	
	// Load configuration
	if err := dw.LoadConfig(configFile); err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}
	
	// Connect to MongoDB
	if err := dw.ConnectMongoDB(); err != nil {
		log.Fatalf("MongoDB connection failed: %v", err)
	}
	
	// Connect to NATS
	if err := dw.ConnectNATS(); err != nil {
		log.Fatalf("NATS connection failed: %v", err)
	}
	
	// Start health server
	dw.startHealthServer()
	
	// Start watching collections
	if err := dw.StartWatching(); err != nil {
		log.Fatalf("Failed to start watching: %v", err)
	}
	
	log.Println("DbWatcher started successfully")
	
	// Wait for interrupt signal
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	<-sigChan
	
	// Graceful shutdown
	dw.Shutdown()
}