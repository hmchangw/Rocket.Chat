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

	"github.com/gorilla/websocket"
	"github.com/nats-io/nats.go"
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
		MaxClients     int    `yaml:"max_clients"`
		PingInterval   time.Duration `yaml:"ping_interval"`
		PingTimeout    time.Duration `yaml:"ping_timeout"`
	} `yaml:"websocket"`
	NATS struct {
		URL           string        `yaml:"url"`
		InputSubject  string        `yaml:"input_subject"`
		MaxReconnect  int           `yaml:"max_reconnect"`
		ReconnectWait time.Duration `yaml:"reconnect_wait"`
	} `yaml:"nats"`
	Broadcasting struct {
		BatchSize       int           `yaml:"batch_size"`
		FlushInterval   time.Duration `yaml:"flush_interval"`
		MaxQueueSize    int           `yaml:"max_queue_size"`
		EnableMetrics   bool          `yaml:"enable_metrics"`
		ClientTimeout   time.Duration `yaml:"client_timeout"`
	} `yaml:"broadcasting"`
	Logging struct {
		Level  string `yaml:"level"`
		Format string `yaml:"format"`
	} `yaml:"logging"`
	Health struct {
		Enabled bool   `yaml:"enabled"`
		Port    string `yaml:"port"`
	} `yaml:"health"`
}

type AggregatedEvent struct {
	Collection    string                 `json:"collection"`
	Action        string                 `json:"action"`
	ClientAction  string                 `json:"clientAction"`
	ID            interface{}            `json:"id"`
	Data          map[string]interface{} `json:"data,omitempty"`
	Diff          map[string]interface{} `json:"diff,omitempty"`
	Unset         map[string]interface{} `json:"unset,omitempty"`
	Timestamp     int64                  `json:"timestamp"`
	OperationType string                 `json:"operationType"`
	Enriched      bool                   `json:"enriched"`
	ProcessedAt   int64                  `json:"processedAt"`
}

type WebSocketClient struct {
	conn       *websocket.Conn
	send       chan []byte
	hub        *BroadcastHub
	remoteAddr string
	connected  time.Time
	lastPing   time.Time
	userAgent  string
}

type BroadcastHub struct {
	clients    map[*WebSocketClient]bool
	broadcast  chan []byte
	register   chan *WebSocketClient
	unregister chan *WebSocketClient
	mutex      sync.RWMutex
	config     *Config
}

type HorizontalBroadcastService struct {
	config         *Config
	natsConn       *nats.Conn
	subscription   *nats.Subscription
	hub            *BroadcastHub
	ctx            context.Context
	cancel         context.CancelFunc
	wg             sync.WaitGroup
	upgrader       websocket.Upgrader
	eventsReceived int64
	eventsBroadcast int64
	startTime      time.Time
	httpServer     *http.Server
	healthServer   *http.Server
}

func NewHorizontalBroadcastService() *HorizontalBroadcastService {
	ctx, cancel := context.WithCancel(context.Background())
	
	hub := &BroadcastHub{
		clients:    make(map[*WebSocketClient]bool),
		broadcast:  make(chan []byte),
		register:   make(chan *WebSocketClient),
		unregister: make(chan *WebSocketClient),
	}
	
	return &HorizontalBroadcastService{
		ctx:         ctx,
		cancel:      cancel,
		hub:         hub,
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool {
				return true // Allow connections from any origin
			},
		},
		startTime: time.Now(),
	}
}

func (hbs *HorizontalBroadcastService) LoadConfig(configFile string) error {
	data, err := os.ReadFile(configFile)
	if err != nil {
		return fmt.Errorf("failed to read config file: %w", err)
	}

	hbs.config = &Config{}
	if err := yaml.Unmarshal(data, hbs.config); err != nil {
		return fmt.Errorf("failed to parse config: %w", err)
	}

	hbs.hub.config = hbs.config
	return nil
}

func (hbs *HorizontalBroadcastService) ConnectNATS() error {
	nc, err := nats.Connect(
		hbs.config.NATS.URL,
		nats.MaxReconnects(hbs.config.NATS.MaxReconnect),
		nats.ReconnectWait(hbs.config.NATS.ReconnectWait),
		nats.DisconnectErrHandler(func(nc *nats.Conn, err error) {
			log.Printf("[BROADCAST] ❌ NATS disconnected: %v", err)
		}),
		nats.ReconnectHandler(func(nc *nats.Conn) {
			log.Printf("[BROADCAST] ✅ NATS reconnected to %s", nc.ConnectedUrl())
		}),
	)
	if err != nil {
		return fmt.Errorf("failed to connect to NATS: %w", err)
	}

	hbs.natsConn = nc
	log.Printf("[BROADCAST] 📡 Connected to NATS: %s (input subject: %s)", 
		hbs.config.NATS.URL, hbs.config.NATS.InputSubject)
	return nil
}

func (hbs *HorizontalBroadcastService) StartEventSubscription() error {
	// Subscribe to aggregated events from WebSocket Aggregator
	sub, err := hbs.natsConn.Subscribe(hbs.config.NATS.InputSubject, hbs.handleAggregatedEvent)
	if err != nil {
		return fmt.Errorf("failed to subscribe to NATS subject: %w", err)
	}
	hbs.subscription = sub

	log.Printf("[BROADCAST] 📥 Subscribed to aggregated events: %s", hbs.config.NATS.InputSubject)
	return nil
}

func (hbs *HorizontalBroadcastService) handleAggregatedEvent(msg *nats.Msg) {
	var event AggregatedEvent
	if err := json.Unmarshal(msg.Data, &event); err != nil {
		log.Printf("[BROADCAST] ❌ Failed to unmarshal aggregated event: %v", err)
		log.Printf("[BROADCAST] 📋 Raw message data: %s", string(msg.Data))
		return
	}

	hbs.eventsReceived++
	
	// Enhanced debug logging
	log.Printf("[BROADCAST] 📨 Received aggregated event [%s]: collection=%s, action=%s, id=%v, enriched=%t", 
		msg.Subject, event.Collection, event.Action, event.ID, event.Enriched)

	if hbs.config.Logging.Level == "debug" || hbs.config.Logging.Level == "trace" {
		log.Printf("[BROADCAST] 🔍 Event details: operationType=%s, timestamp=%d, processedAt=%d, payload_size=%d bytes", 
			event.OperationType, event.Timestamp, event.ProcessedAt, len(msg.Data))
		
		if hbs.config.Logging.Level == "trace" {
			log.Printf("[BROADCAST] 📋 Event payload: %s", string(msg.Data))
		}
	}

	// Broadcast to all connected WebSocket clients
	clientCount := len(hbs.hub.clients)
	if clientCount > 0 {
		log.Printf("[BROADCAST] 🌐 Broadcasting to %d WebSocket clients", clientCount)
		
		// Use the hub's broadcast channel for efficient distribution
		select {
		case hbs.hub.broadcast <- msg.Data:
			hbs.eventsBroadcast++
		default:
			log.Printf("[BROADCAST] ⚠️ Broadcast channel full, dropping event")
		}
	} else {
		log.Printf("[BROADCAST] 📭 No WebSocket clients connected, event not broadcast")
	}

	// Enhanced debug logging
	if hbs.config.Logging.Level == "debug" || hbs.config.Logging.Level == "trace" {
		log.Printf("[BROADCAST] 📊 Total events: received=%d, broadcast=%d, uptime=%.1fs", 
			hbs.eventsReceived, hbs.eventsBroadcast, time.Since(hbs.startTime).Seconds())
	}
}

func (hbs *HorizontalBroadcastService) startBroadcastHub() {
	hbs.wg.Add(1)
	go func() {
		defer hbs.wg.Done()
		hbs.hub.run()
	}()
}

func (hub *BroadcastHub) run() {
	ticker := time.NewTicker(54 * time.Second) // WebSocket ping interval
	defer ticker.Stop()

	for {
		select {
		case client := <-hub.register:
			hub.mutex.Lock()
			hub.clients[client] = true
			hub.mutex.Unlock()
			
			log.Printf("[BROADCAST] ➕ New client registered from %s. Total clients: %d", 
				client.remoteAddr, len(hub.clients))

		case client := <-hub.unregister:
			hub.mutex.Lock()
			if _, ok := hub.clients[client]; ok {
				delete(hub.clients, client)
				close(client.send)
			}
			hub.mutex.Unlock()
			
			log.Printf("[BROADCAST] ➖ Client unregistered from %s. Total clients: %d", 
				client.remoteAddr, len(hub.clients))

		case message := <-hub.broadcast:
			hub.mutex.RLock()
			clients := make([]*WebSocketClient, 0, len(hub.clients))
			for client := range hub.clients {
				clients = append(clients, client)
			}
			hub.mutex.RUnlock()

			// Broadcast to all clients with timeout handling
			var successCount, failCount int
			for _, client := range clients {
				select {
				case client.send <- message:
					successCount++
				default:
					// Client's send channel is full or closed
					hub.mutex.Lock()
					if _, ok := hub.clients[client]; ok {
						delete(hub.clients, client)
						close(client.send)
					}
					hub.mutex.Unlock()
					failCount++
				}
			}

			if hub.config.Logging.Level == "debug" {
				log.Printf("[BROADCAST] 📤 Broadcast complete: success=%d, failed=%d, total_clients=%d", 
					successCount, failCount, len(clients))
			}

		case <-ticker.C:
			// Send ping to all clients to keep connections alive
			hub.mutex.RLock()
			for client := range hub.clients {
				select {
				case client.send <- []byte(`{"type":"ping","timestamp":` + fmt.Sprintf("%d", time.Now().UnixMilli()) + `}`):
					client.lastPing = time.Now()
				default:
					// Remove unresponsive clients
				}
			}
			hub.mutex.RUnlock()
		}
	}
}

func (hbs *HorizontalBroadcastService) startWebSocketServer() {
	mux := http.NewServeMux()
	mux.HandleFunc(hbs.config.WebSocket.Path, hbs.handleWebSocketConnection)
	
	hbs.upgrader.ReadBufferSize = hbs.config.WebSocket.ReadBufferSize
	hbs.upgrader.WriteBufferSize = hbs.config.WebSocket.WriteBufferSize

	hbs.httpServer = &http.Server{
		Addr:    fmt.Sprintf("%s:%s", hbs.config.Server.Host, hbs.config.WebSocket.Port),
		Handler: mux,
	}

	hbs.wg.Add(1)
	go func() {
		defer hbs.wg.Done()
		log.Printf("[BROADCAST] 🌐 WebSocket server started on port %s%s (read buffer: %d, write buffer: %d, max clients: %d)", 
			hbs.config.WebSocket.Port, hbs.config.WebSocket.Path, 
			hbs.config.WebSocket.ReadBufferSize, hbs.config.WebSocket.WriteBufferSize,
			hbs.config.WebSocket.MaxClients)
		
		if err := hbs.httpServer.ListenAndServe(); err != http.ErrServerClosed {
			log.Printf("[BROADCAST] ❌ WebSocket server error: %v", err)
		}
	}()
}

func (hbs *HorizontalBroadcastService) handleWebSocketConnection(w http.ResponseWriter, r *http.Request) {
	// Check max clients limit
	if len(hbs.hub.clients) >= hbs.config.WebSocket.MaxClients {
		log.Printf("[BROADCAST] ⚠️ Max clients reached (%d), rejecting connection from %s", 
			hbs.config.WebSocket.MaxClients, r.RemoteAddr)
		http.Error(w, "Max clients reached", http.StatusServiceUnavailable)
		return
	}

	conn, err := hbs.upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[BROADCAST] ❌ WebSocket upgrade error: %v", err)
		return
	}

	client := &WebSocketClient{
		conn:       conn,
		send:       make(chan []byte, 256),
		hub:        hbs.hub,
		remoteAddr: r.RemoteAddr,
		connected:  time.Now(),
		lastPing:   time.Now(),
		userAgent:  r.Header.Get("User-Agent"),
	}

	// Register the client
	client.hub.register <- client

	// Start client goroutines
	go client.writePump()
	go client.readPump()
}

func (c *WebSocketClient) readPump() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()

	c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	for {
		_, _, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("[BROADCAST] ❌ WebSocket error: %v", err)
			}
			break
		}
	}
}

func (c *WebSocketClient) writePump() {
	ticker := time.NewTicker(54 * time.Second)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			w, err := c.conn.NextWriter(websocket.TextMessage)
			if err != nil {
				return
			}
			w.Write(message)

			// Add queued messages to the current websocket message
			n := len(c.send)
			for i := 0; i < n; i++ {
				w.Write([]byte{'\n'})
				w.Write(<-c.send)
			}

			if err := w.Close(); err != nil {
				return
			}

		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func (hbs *HorizontalBroadcastService) startHealthServer() {
	if !hbs.config.Health.Enabled {
		return
	}

	mux := http.NewServeMux()
	
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		clientCount := len(hbs.hub.clients)

		status := map[string]interface{}{
			"status":            "healthy",
			"uptime":            time.Since(hbs.startTime).Seconds(),
			"events_received":   hbs.eventsReceived,
			"events_broadcast":  hbs.eventsBroadcast,
			"websocket_clients": clientCount,
			"nats_connected":    hbs.natsConn != nil && hbs.natsConn.IsConnected(),
			"timestamp":         time.Now().UnixMilli(),
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(status)
	})

	mux.HandleFunc("/metrics", func(w http.ResponseWriter, r *http.Request) {
		clientCount := len(hbs.hub.clients)

		metrics := map[string]interface{}{
			"events_received":    hbs.eventsReceived,
			"events_broadcast":   hbs.eventsBroadcast,
			"uptime_seconds":     time.Since(hbs.startTime).Seconds(),
			"websocket_clients":  clientCount,
			"nats_connected":     hbs.natsConn != nil && hbs.natsConn.IsConnected(),
			"start_time":         hbs.startTime.Unix(),
			"current_time":       time.Now().Unix(),
			"max_clients":        hbs.config.WebSocket.MaxClients,
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(metrics)
	})

	mux.HandleFunc("/clients", func(w http.ResponseWriter, r *http.Request) {
		hbs.hub.mutex.RLock()
		clients := make([]map[string]interface{}, 0, len(hbs.hub.clients))
		for client := range hbs.hub.clients {
			clients = append(clients, map[string]interface{}{
				"remote_addr":  client.remoteAddr,
				"connected":    client.connected.Format(time.RFC3339),
				"last_ping":    client.lastPing.Format(time.RFC3339),
				"user_agent":   client.userAgent,
				"duration":     time.Since(client.connected).Seconds(),
			})
		}
		hbs.hub.mutex.RUnlock()

		response := map[string]interface{}{
			"total_clients": len(clients),
			"clients":       clients,
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)
	})

	hbs.healthServer = &http.Server{
		Addr:    fmt.Sprintf("%s:%s", hbs.config.Server.Host, hbs.config.Health.Port),
		Handler: mux,
	}

	hbs.wg.Add(1)
	go func() {
		defer hbs.wg.Done()
		log.Printf("[BROADCAST] 🏥 Health server started on port %s", hbs.config.Health.Port)
		if err := hbs.healthServer.ListenAndServe(); err != http.ErrServerClosed {
			log.Printf("[BROADCAST] ❌ Health server error: %v", err)
		}
	}()
}

func (hbs *HorizontalBroadcastService) Shutdown() error {
	log.Printf("[BROADCAST] 🛑 Shutting down Horizontal Broadcast Service...")
	
	hbs.cancel()
	
	// Close NATS subscription
	if hbs.subscription != nil {
		hbs.subscription.Unsubscribe()
		log.Printf("[BROADCAST] 📡 NATS subscription closed")
	}
	
	// Shutdown HTTP servers
	if hbs.httpServer != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		hbs.httpServer.Shutdown(ctx)
		cancel()
	}
	
	if hbs.healthServer != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		hbs.healthServer.Shutdown(ctx)
		cancel()
	}
	
	// Close all WebSocket clients
	hbs.hub.mutex.Lock()
	for client := range hbs.hub.clients {
		close(client.send)
		client.conn.Close()
	}
	hbs.hub.clients = make(map[*WebSocketClient]bool)
	hbs.hub.mutex.Unlock()
	
	// Wait for goroutines to finish
	hbs.wg.Wait()
	
	// Close NATS connection
	if hbs.natsConn != nil {
		hbs.natsConn.Close()
		log.Printf("[BROADCAST] 📡 NATS connection closed")
	}
	
	log.Printf("[BROADCAST] ✅ Horizontal Broadcast Service shutdown complete")
	return nil
}

func main() {
	configFile := "config.yaml"
	if len(os.Args) > 1 {
		configFile = os.Args[1]
	}

	hbs := NewHorizontalBroadcastService()
	
	// Load configuration
	if err := hbs.LoadConfig(configFile); err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}
	
	// Connect to NATS
	if err := hbs.ConnectNATS(); err != nil {
		log.Fatalf("NATS connection failed: %v", err)
	}
	
	// Start servers and services
	hbs.startHealthServer()
	hbs.startWebSocketServer()
	hbs.startBroadcastHub()
	
	// Start event subscription
	if err := hbs.StartEventSubscription(); err != nil {
		log.Fatalf("Failed to start event subscription: %v", err)
	}
	
	log.Printf("[BROADCAST] 🚀 Horizontal Broadcast Service started successfully")
	
	// Wait for interrupt signal
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	<-sigChan
	
	// Graceful shutdown
	hbs.Shutdown()
}