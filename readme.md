# API Gateway - Unified GPS API

**Project Specification Document**

**Version:** 1.2.0 (Architecture Refined)
**Status:** Production Ready
**Last Updated:** June 22, 2026

## What's New in v1.2.0

| Feature | Description |
|---------|-------------|
| **Custom Groups** | Buat grup sendiri di middleware, tidak tergantung group/BC dari Traccar/MSPF |
| **Device Mapping** | Assign device dari Traccar/MSPF ke custom group via `device_groups` |
| **Group Auto-Sync** | Otomatis sync device dari source group/BC ke custom group |
| **Custom Attributes** | Filter/rename/compute atribut per custom group (3 mode: passthrough, rename, compute) |
| **Attribute Preview** | FE bisa lihat atribut mana yang muncul untuk group tertentu |
| **Pagination Stable** | Device list sorted by ID — infinite scroll tanpa duplicate

## Data Normalization Strategy

Semua data dari **MSPF dinormalisasi ke format Traccar** agar FE tidak perlu handle dua format berbeda.

| Aspek | MSPF Asli | Output Gateway (Traccar Format) |
|-------|-----------|-------------------------------|
| Device status | `"WORKING"` / `"SUSPENDED"` | `"online"` / `"offline"` |
| Unique ID | `uniqueId` atau `imei` | `uniqueId` (Traccar field) |
| Phone | `mobileNo` | `phone` |
| Model | `deviceType` | `model` |
| Tags | `tags: object` | `attributes: object` |
| Position list | `{ data: [{ deviceId, position: {...} }] }` | Flat array `[{id, deviceId, latitude, ...}]` |

Field tambahan khusus Gateway (ada di semua device):
- `source: 'traccar' | 'mspf'` — asal data
- `group: 'traccar_5' | 'mspf_3'` — composite ID

## Document Revisions (v1.0.0 → v1.1.0)

| Change | Description |
|--------|-------------|
| **Authentication** | Added dedicated minimal relational database (PostgreSQL/MySQL) at the Gateway level strictly for Frontend User Management |
| **M2M Communication** | Replaced legacy backend login flow with static API Tokens stored in environment variables for zero-overhead backend authentication |
| **Real-time Architecture** | Formalized the WebSocket Bridge mechanism (Gateway subscribes to Traccar WS, polls MSPF API, and emits a single WS stream to Frontend) |
| **Pagination & Aggregation** | Introduced In-Memory Caching (Redis/Node-Cache) to handle combined data pagination without storing GPS data in a database |
| **Naming** | Renamed "Legacy GPS Server" to "MSPF" (Multi-Sensor Processing Framework) |
| **Device Routing** | Replaced ID prefix routing with **Group/BC-based routing**. Device IDs are raw integers. Gateway uses composite group IDs (`traccar_5`, `mspf_3`) and a device-source mapping cache to route requests to the correct backend. |

---

## 1. Project Overview

### 1.1 Purpose

This API Gateway serves as a unified middleware layer that aggregates two separate GPS tracking systems into a single, cohesive API endpoint for a custom Frontend (FE) application:

| System | Purpose | Device Types |
|--------|---------|--------------|
| Traccar Server | Open-source GPS tracking platform | Standard GPS trackers |
| MSPF Server | Multi-Sensor Processing Framework | Devices with MCCS model data |
| API Gateway (BFF) | Centralized proxy and aggregator | Frontend UI facing |

The gateway acts as a Backend for Frontend (BFF) that abstracts away the complexity of multiple data sources from client applications.

### 1.2 Business Requirements

| Requirement | Priority | Description |
|-------------|----------|-------------|
| Unified API | Critical | Single middleware API that aggregates device data from both Traccar and MSPF servers |
| No Data Duplication | Critical | Historical GPS data remains only in respective source systems; Gateway stores only FE user credentials |
| Zero MSPF Changes | Critical | No modifications to the MSPF server code required |
| Centralized Authentication | High | Single sign-on mechanism for all API consumers |
| Transparent Routing | High | Automatic device routing based on Group (Traccar) or BC (MSPF) membership |
| Full Traccar Features | High | All Traccar functionality preserved for standard devices |
| MCCS Data Passthrough | High | MCCS-specific data from MSPF must be passed through to FE without transformation |
| Custom Grouping | High | Ability to create custom groups in middleware, independent of Traccar/MSPF groups |
| Custom Attributes | High | Admin can define custom attributes (passthrough, rename, compute) per group |
| Command Execution | High | Ability to send commands to devices in both systems |

### 1.3 Key Constraints

| Constraint | Impact |
|------------|--------|
| No Data Duplication | Gateway Database MUST NOT store GPS coordinates, history, or device lists. It only stores FE user credentials |
| Zero MSPF Changes | No modifications to the MSPF server code are allowed |
| Stateless Architecture | No session persistence; all state managed via JWT |
| Stateless GPS Proxy | Gateway uses memory/Redis to cache active device lists temporarily for pagination, ensuring no permanent GPS storage |
| MSPF API Limitations | Gateway adapts to existing API structure; cannot modify MSPF system |
| Network Requirements | Gateway must have network access to both backend systems |

---

## 2. System Architecture

### 2.1 High-Level Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│                          Frontend Applications                       │
│                     (React, Vue, Mobile Apps, etc.)                  │
└────────┬─────────────────────────────────────────────────────▲───────┘
         │ HTTPS / REST API                                    │ WebSocket (Live)
         ▼                                                     │
┌──────────────────────────────────────────────────────────────────────┐
│                        API GATEWAY (Node.js)                         │
│                                                                      │
│  ┌────────────────┐ ┌───────────────┐ ┌───────────────────────────┐  │
│  │ Auth DB (SQL)  │ │ Cache (Redis) │ │ WebSocket Aggregator      │  │
│  │ - Users/Roles  │ │ - Temp arrays │ │ - WS Client (to Traccar)  │  │
│  │ - Passwords    │ │ - Pagination  │ │ - Polling (to MSPF)       │  │
│  └────────────────┘ └───────────────┘ └───────────────────────────┘  │
│                                                                      │
│    Functions:                                                       │
│    • JWT Authentication (against Gateway DB)                        │
│    • Device Routing Engine (via group/BC mapping)                   │
│    • Response Aggregation with Caching                              │
│    • Device ↔ Source mapping (cache)                                │
│    • WebSocket Bridge                                               │
│    • Command Proxy                                                  │
│    • Request/Response Logging                                       │
│    • Error Handling                                                 │
└────────┬─────────────────────────────────────────────┬───────────────┘
         │                                             │
         ▼ (Bearer Token)                              ▼ (Bearer Token)
┌────────────────────────┐                    ┌────────────────────────┐
│     Traccar API        │                    │    MSPF Server         │
│     (Port: 8082/5055)  │                    │                        │
│                        │                    │                        │
│  • Standard Devices    │                    │  • MCCS Devices        │
│  • WebSocket Emitter   │                    │  • REST API Polling    │
│  • Groups               │                    │  • BC (business unit)  │
│  • Geofence, Reports   │                    │  • Proprietary Data    │
└────────────────────────┘                    └────────────────────────┘
```

### 2.2 Data Flow Patterns

#### Pattern 1: Device Listing with Pagination (Cache & Merge)

```
FE Request: GET /api/devices?page=2&limit=50
       │
       ▼
   Gateway checks cache
       │
       ├── Cache HIT → Return paginated slice from cache
       │
       ├── With group filter (e.g. group=mspf_3)
       │   └── Route to MSPF only → bcId=3
       │
       └── Cache MISS → Parallel API Calls (no group filter)
           ┌─────────────────────────────────────┐
           │  Traccar GET /api/devices           │
           │  MSPF GET /v3/devices               │
           └─────────────────────────────────────┘
               │
               ▼
           Merge Results
           • Add source flag ('traccar' or 'mspf')
           • Map Traccar groupId → composite ID
           • Map MSPF bcId → composite ID
               │
               ▼
           Store merged array + device→source mapping in cache
               │
               ▼
           Slice array by page/limit → Return paginated response
```

#### Pattern 2: Device-Specific Data (Group/BC-Based Routing)

```
FE: GET /api/devices/123?group=mspf_3
       │
       ▼
   Gateway parses group=mspf_3
       │
       ▼
   source = 'mspf', bcId = 3
       │
       ▼
   Route to MSPF: GET /v3/devices/123
       │
       ▼
   Return device detail + MCCS data
```

#### Pattern 3: Group/BC Listing

```
FE: GET /api/groups
       │
       ▼
   Gateway fetches:
   ┌─────────────────────────────────────┐
   │  Traccar GET /api/groups            │
   │  MSPF   GET /v2/bc                  │
   └─────────────────────────────────────┘
       │
       ▼
   Merge and normalize:
   • traccar_1 → { id: "traccar_1", name: "Logistik", source: "traccar" }
   • mspf_3   → { id: "mspf_3", name: "Cold Chain", source: "mspf" }
       │
       ▼
   Return merged list
```

#### Pattern 4: Unified Real-Time Tracking (WebSocket Bridge)

```
Connection: Socket.io (ws://gateway/api/ws)
Auth: JWT token passed in auth option during handshake
       │
       ▼
Gateway opens WebSocket connection to Traccar Backend
Gateway starts setInterval background worker to poll MSPF API
       │
       ▼
When Gateway receives updates (from either Traccar WS or MSPF poll):
       │
       ▼
Normalize payload → Emit to FE via Socket.io events:
  • "position"       → device position update
  • "device-status"  → online/offline change
  • "command-result" → command execution status
```

**Connection Details:**
| Item | Value |
|------|-------|
| URL | `wss://api-gateway.example.com/api/ws` |
| Library | Socket.io (server & client) |
| Auth | Token dikirim via `auth.token` saat handshake |
| Events | `position`, `device-status`, `command-result` |
| MSPF Poll Interval | Configurable via env var `MSPF_POLL_INTERVAL` (default: 10000ms) |

### 2.3 Device Identification Strategy

Since both Traccar and MSPF use **integer device IDs** with no prefix, the Gateway uses a **Group/BC-based routing** approach:

| Strategy | Description |
|----------|-------------|
| **Group/BC Composite ID** | Each Traccar group and MSPF BC is assigned a composite ID (`traccar_{groupId}` or `mspf_{bcId}`) |
| **Device-Source Mapping** | Gateway maintains a cache mapping `deviceId → source` populated from device list calls |
| **Source Parameter** | FE can optionally pass `source=traccar` or `source=mspf` to disambiguate device requests |
| **Group Filter** | FE passes `group=traccar_5` or `group=mspf_3` to filter devices by organizational unit |

**Routing Logic:**
1. If `source` parameter is provided → route directly to that backend
2. If `group` parameter is provided → parse composite ID → route to appropriate backend
3. If `deviceId` is provided without source → look up device→source mapping in cache
4. Default fallback → query both backends and merge results

---

## 3. Technical Stack

### 3.1 Core Technologies

| Component | Technology | Version | Purpose |
|-----------|------------|---------|---------|
| Runtime | Node.js | ≥18.0.0 | JavaScript runtime environment |
| Web Framework | Express.js | 4.18.2 | HTTP server, routing, middleware |
| HTTP Client | Axios | 1.5.0 | HTTP requests to backend APIs |
| Authentication | JWT (jsonwebtoken) | 9.0.2 | Token-based authentication |
| Password Security | bcryptjs | 2.4.3 | Password hashing |
| Database | PostgreSQL / MySQL | - | Storing FE user credentials & roles |
| Caching | Node-Cache (dev) / Redis (production) | - | In-memory aggregation for pagination |
| WebSocket | Socket.io / ws | - | Unified WebSocket server for FE |
| Configuration | dotenv | 16.3.1 | Environment variable management |
| Logging | Morgan + Winston | 1.10.0 | Request logging and application logs |
| Security Headers | Helmet | 7.0.0 | Security header middleware |
| Input Validation | express-validator | - | Request body/query/params validation |
| HTTP Errors | http-errors | - | Standardized HTTP error creation |
| CORS | cors | 2.8.5 | Cross-origin resource sharing |

### 3.2 External Dependencies

| Service | Purpose | Auth Method |
|---------|---------|-------------|
| Traccar API | Standard GPS device data | **Basic Auth** (username:password from .env, sent as `Authorization: Basic ...`) |
| MSPF API | MCCS device data | **OAuth2 client_credentials** (`MSPF_CLIENT_ID` + `MSPF_CLIENT_SECRET` → access token → Bearer header, auto-refresh) |

---

## 4. Core Features

### 4.1 Frontend Authentication & Authorization

| Feature | Description |
|---------|-------------|
| Independent Identity | Users authenticate against the Gateway's own database. FE does not know backend credentials |
| JWT-based Auth | Secure token-based authentication with configurable expiry |
| Centralized Login | Single login endpoint for all applications |
| Role-Based Access | Gateway issues a JWT containing the user's role (admin, user, viewer) |
| Group/BC Access Control | Customer users are mapped to specific Groups (Traccar) and/or BCs (MSPF) |
| M2M Authentication | Gateway uses static tokens (configured via .env) to authenticate against Traccar and MSPF APIs |
| Secure Password | Passwords stored as bcrypt hashes |

### 4.2 Group & BC Management

| Feature | Description |
|---------|-------------|
| Unified Group List | Combined list of Traccar groups and MSPF BCs with composite IDs |
| Auto-routing | Selecting a group automatically routes device queries to the correct backend |
| Access Control | Admin sees all groups/BCs; customers see only their assigned ones |

### 4.3 Device Management

| Feature | Description |
|---------|-------------|
| Unified Device List | Combined list from both sources with source attribution |
| Group/BC Filter | Filter devices by composite group ID (e.g. `group=mspf_3`) |
| Device Search | Search by name, uniqueId, or ID |
| Status Filtering | Filter by online/offline status |
| Source Filtering | Filter by specific source (Traccar or MSPF) |
| Device Details | Full device information from appropriate source |
| MCCS Data Passthrough | MCCS-specific fields from MSPF devices are passed through to FE without transformation |

### 4.4 Position Data & Real-time

| Feature | Description |
|---------|-------------|
| Real-time Positions | Handled exclusively via Gateway's WebSocket bridging mechanism to save FE HTTP overhead |
| Historical Data | Routed dynamically to the respective backend based on Device ID or Group |
| Automatic Routing | Routes to correct backend based on device ID lookup or group parameter |
| Unified Format | Consistent data structure regardless of source |
| Pagination Support | Limit and offset parameters for large datasets (backed by cache) |

### 4.5 Command Execution

| Feature | Description |
|---------|-------------|
| Device Commands | Send commands to devices (restart, stop engine, etc.) |
| Activation (MSPF) | Set device status to ACTIVE or INACTIVE via MSPF activation endpoint |
| Command Types | Different command sets for different backends |
| Command Status | Real-time command execution feedback |
| Type Discovery | Endpoint to list available commands per device |

### 4.6 Monitoring & Health

| Feature | Description |
|---------|-------------|
| Health Checks | Basic and detailed health endpoints |
| Dependency Status | Monitor availability of backend services |
| Kubernetes Probes | Ready and liveness probes for orchestration |
| Request Tracing | Unique request IDs for debugging |
| Performance Metrics | Response time and error rate tracking |

---

## 5. API Specification

### 5.1 Authentication Endpoints (Gateway DB)

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | /api/auth/login | Validate against Gateway DB, return JWT | No |
| GET | /api/auth/me | Get current user profile | Yes |
| POST | /api/auth/refresh | Refresh JWT token | Yes |

### 5.2 Group Endpoints

| Method | Endpoint | Description | Query Parameters |
|--------|----------|-------------|------------------|
| GET | /api/groups | Get list of groups/BCs (merged) | source |

### 5.3 Device Endpoints

| Method | Endpoint | Description | Query Parameters |
|--------|----------|-------------|------------------|
| GET | /api/devices | Get all devices (with caching & pagination) | page, limit, group, source, status, search |
| GET | /api/devices/:id | Get device by ID | group, source |

### 5.4 Position Endpoints

| Method | Endpoint | Description | Query Parameters |
|--------|----------|-------------|------------------|
| GET | /api/positions | Get positions | deviceId, group, source, from, to, limit |
| GET | /api/positions/latest | Get latest positions | deviceId, group, source |

### 5.5 Command & Activation Endpoints

| Method | Endpoint | Description | Request Body |
|--------|----------|-------------|--------------|
| POST | /api/commands | Send command to device | { deviceId, type, data, group?, source? } |
| GET | /api/commands/types/:deviceId | List available commands | group, source |
| PUT | /api/devices/:id/activation | Activate/deactivate vehicle (unified — Traccar & MSPF) | { desiredStatus, group?, source? } |

**Activation mapping:**

| desiredStatus | MSPF | Traccar |
|---------------|------|---------|
| `ACTIVE` | `PUT /v3/devices/{id}/activation` → ACTIVE | `POST /commands/send` → `engineResume` |
| `INACTIVE` | `PUT /v3/devices/{id}/activation` → INACTIVE | `POST /commands/send` → `engineStop` |

### 5.6 Health Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /health | Basic health check |
| GET | /health/detailed | Detailed health with dependencies |

### 5.7 User Management (Admin)

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | /api/users | List all users | Admin |
| GET | /api/users/:id | Get user detail | Admin |
| PUT | /api/users/:id/groups | Set user's group/BC assignments | Admin |

```json
// PUT /api/users/:id/groups
{
  "groups": ["traccar_5", "mspf_3", "traccar_8"]
}
```

> Admin mengelola assignment Group/BC ke customer melalui endpoint ini.
> 1 customer bisa memiliki akses ke lebih dari 1 Group (Traccar) dan/atau BC (MSPF).

### 5.8 WebSocket

| Item | Value |
|------|-------|
| URL | `wss://api-gateway.example.com/api/ws` |
| Library | Socket.io |
| Auth | Pass JWT via `auth.token` option saat handshake |
| Events | `position`, `device-status`, `command-result` |

**Event Payloads:**

```typescript
// Event: "position"
interface WsPosition {
  deviceId: number;
  latitude: number;
  longitude: number;
  speed: number;
  course: number;
  deviceTime: string;
  source: 'traccar' | 'mspf';
}

// Event: "device-status"
interface WsDeviceStatus {
  deviceId: number;
  status: 'online' | 'offline';
  source: 'traccar' | 'mspf';
}

// Event: "command-result"
interface WsCommandResult {
  deviceId: number;
  commandType: string;
  success: boolean;
  message: string;
  source: 'traccar' | 'mspf';
}
```

**FE Connection Example (JavaScript):**

```javascript
const socket = io('wss://api-gateway.example.com/api/ws', {
  auth: { token: 'JWT_TOKEN_HERE' }
});

socket.on('position', (data) => {
  // update map / UI
});

socket.on('device-status', (data) => {
  // update status indicator
});

socket.on('command-result', (data) => {
  // show command result
});
```

---

## 6. Data Models

### 6.1 User Model (Gateway Database)

```typescript
interface User {
  id: string;                    // UUID
  username: string;              // Login username
  password_hash: string;         // bcrypt hashed password
  role: 'admin' | 'customer';
  groups: string[];              // Composite group IDs accessible (e.g. ["traccar_5", "mspf_3"])
  created_at: string;
}
```

### 6.2 Group/BC Model (Merged)

```typescript
interface Group {
  id: string;                    // Composite ID: 'traccar_5' or 'mspf_3'
  name: string;                  // Group or BC name
  source: 'traccar' | 'mspf';    // Source system
  groupId?: number;              // Traccar groupId (only for source=traccar)
  bcId?: number;                 // MSPF bcId (only for source=mspf)
  deviceCount: number;           // Number of devices in this group/BC
}
```

### 6.3 MCCS Model (MSPF-Specific — Mobility Data)

MCCS device mengirimkan data telemetri melalui MSPF. Data ini bisa diakses via `GET /v2/device/{id}/data/history` dan dimasukkan ke `attributes` device.

```typescript
interface MCCSMobilityData {
  tid: string;                    // Terminal ID
  mid: string;                    // Telephone number (SIM)
  ts: number;                     // RTC unix timestamp
  code: number;                   // Status code (e.g. 61472 = periodic report)
  lat: number;                    // Latitude
  lon: number;                    // Longitude
  alt: number;                    // Altitude (m)
  kph: number;                    // Speed (km/h)
  dir: number;                    // Direction / bearing (°, true north)
  hdop: number;                   // Horizontal Dilution of Precision
  sats: number;                   // Number of satellites in view
  odom: number;                   // Odometer (km)
  gpio: number;                   // GPIO status bitmask (IGN, PARK, EXT GPIO, etc.)
  volt: number;                   // External battery voltage (V)
  ver: string;                    // Application software version
  sno: string;                    // Serial number
  accm: number;                   // Accelerometer max value (g)
  relay: number;                  // Relay setting value (MCCS only)
  mode: number;                   // MCCS mode (0=NORMAL, 1=SLEEP1, ...)
  addr: {
    IGN: number;                  // Ignition status
    FIX: number;                  // GPS fix mode
    EB: number;                   // External battery voltage
    IB: number;                   // Internal battery voltage
    AD: number;                   // ADC1 input port voltage
    AD2?: number;                 // ADC2 input port voltage
    TE: number;                   // Board temperature (°C)
    RS: number;                   // RSSI (dBm)
    NT: string;                   // Network status
    x: number;                    // G-sensor X axis (g)
    y: number;                    // G-sensor Y axis (g)
    z: number;                    // G-sensor Z axis (g)
  };
}
```

**RunningStatus** (dihitung dari `kph` dan `addr.IGN`):

| Status | Kondisi |
|--------|---------|
| `RUN` | Engine ON + kendaraan bergerak (kph ≥ 1) |
| `STOP` | Engine OFF |
| `IDLING` | Engine ON + kendaraan berhenti (kph = 0) |
| `UNKNOWN` | Tidak ada komunikasi > 1 hari |

### 6.4 Device Model (Mengikuti Format Traccar)

```typescript
interface Device {
  id: number;                    // Raw integer device ID
  name: string;                  // Device name
  uniqueId: string;              // IMEI / Identifier
  status: 'online' | 'offline';
  phone?: string;                // Phone number (dari MSPF mobileNo)
  model?: string;                // Device model / tipe
  source: 'traccar' | 'mspf';    // Data source (field Gateway)
  group: string;                 // Composite group/BC ID (field Gateway, e.g. "traccar_5", "mspf_3")
  attributes?: Record<string, any>; // Tags/attributes tambahan

  // Khusus MSPF (via DeviceStatus endpoint):
  running?: 'RUN' | 'STOP' | 'IDLING' | 'UNKNOWN';  // MCCS running status
  ignition?: 'ON' | 'OFF';       // Ignition status
  voltage?: number;              // Power supply voltage (V)
  firmwareVersion?: string;      // Firmware version
  lastCommunicatedAt?: string;   // Last communication timestamp
}
```

### 6.5 Position Model (Mengikuti Format Traccar)

```typescript
interface Position {
  id?: number;                   // Position identifier
  deviceId: number;              // Device identifier
  latitude: number;              // Latitude in decimal degrees
  longitude: number;             // Longitude in decimal degrees
  speed: number;                 // Speed (km/h or knots)
  course: number;                // Heading in degrees
  altitude: number;              // Altitude in meters
  deviceTime: string;            // ISO timestamp from device
  serverTime: string;            // ISO timestamp from server
  fixTime: string;               // ISO timestamp of GPS fix
  valid: boolean;                // Data validity
  source: 'traccar' | 'mspf';    // Data source (field Gateway)
  attributes?: Record<string, any>; // Additional attributes
}
```

### 6.6 Command Model

```typescript
interface Command {
  deviceId: number;              // Target device
  type: string;                  // Command type
  data?: Record<string, any>;    // Additional parameters
}

interface Activation {
  deviceId: number;
  desiredStatus: 'ACTIVE' | 'INACTIVE';
}
```

---

## 7. Security & Environment Configuration

### 7.1 Caching Strategy

| Aspect | Node-Cache (Development) | Redis (Production) |
|--------|-------------------------|-------------------|
| Setup | Zero configuration, in-process | Requires Redis server instance |
| Data Persistence | Lost on restart | Persistent (RDB/AOF) |
| Scalability | Single process only | Shared across multiple instances |
| Use Case | Local dev, single-container Docker | Multi-replica K8s, high availability |

**Recommendation:** Use Node-Cache for development and single-instance deployments. Use Redis for production deployments with multiple replicas to ensure cache consistency.

### 7.2 Environment Variables (.env)

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| PORT | Yes | Gateway Application port | 3000 |
| DB_HOST | Yes | Gateway Auth DB Host | localhost |
| DB_PORT | No | Gateway Auth DB Port | 5432 |
| DB_NAME | Yes | Gateway Auth DB Name | gateway_users |
| DB_USER | Yes | Gateway Auth DB User | postgres |
| DB_PASS | Yes | Gateway Auth DB Password | secure_db_pass |
| JWT_SECRET | Yes | Secret for FE JWT signing | super_secret_key |
| JWT_EXPIRY | No | Token expiry duration | 8h |
| TRACCAR_URL | Yes | Base URL for Traccar | http://10.0.0.5:8082 |
| TRACCAR_USERNAME | Yes | Traccar admin username | admin |
| TRACCAR_PASSWORD | Yes | Traccar admin password | secure_password |
| MSPF_URL | Yes | Base URL for MSPF Server | https://api.cloud-gms.com |
| MSPF_CLIENT_ID | Yes | MSPF OAuth2 client ID | your_client_id |
| MSPF_CLIENT_SECRET | Yes | MSPF OAuth2 client secret | your_client_secret |
| MSPF_TOKEN_URL | No | Custom token URL (default: from MSPF_URL) | |
| CACHE_TTL | No | Cache TTL in seconds | 300 |
| CACHE_PROVIDER | No | Cache backend: node-cache or redis | node-cache |
| WEBSOCKET_PATH | No | WebSocket path | /api/ws |
| MSPF_POLL_INTERVAL | No | MSPF polling interval (ms) | 10000 |
| RATE_LIMIT_WINDOW_MS | No | Rate limit window (ms) | 60000 |
| RATE_LIMIT_MAX | No | Max requests per window | 100 |
| RATE_LIMIT_AUTH_MAX | No | Max login attempts per window | 20 |
| REDIS_URL | No | Redis connection string (Socket.io multi-instance) | redis://localhost:6379 |
| CORS_ORIGIN | No | Allowed CORS origins | https://app.example.com |
| LOG_LEVEL | No | Logging level | info |
| REQUEST_TIMEOUT | No | API request timeout (ms) | 30000 |

### 7.3 Security Layers

| Layer | Implementation | Description |
|-------|---------------|-------------|
| Transport | HTTPS | All API communication encrypted |
| Authentication | JWT (Gateway DB) | Stateless token-based authentication against Gateway's own database |
| Authorization | Role-based + Group/BC | User roles: admin, customer. Customers restricted to assigned groups/BCs |
| M2M Auth | Basic Auth (Traccar) + OAuth2 (MSPF) | Traccar: Basic Auth via username/password. MSPF: OAuth2 client_credentials → Bearer token + auto-refresh |
| Request Validation | Schema validation | Input validation using Joi/express-validator |
| Rate Limiting | express-rate-limit | Prevent abuse and DDoS |
| CORS | Configured origins | Restrict allowed domains |
| Security Headers | Helmet | Security HTTP headers (HSTS, XSS protection) |

### 7.4 JWT Configuration

| Parameter | Value | Description |
|-----------|-------|-------------|
| Algorithm | HS256 | HMAC using SHA-256 |
| Token Expiry | 8 hours (configurable) | Session duration |
| Secret Length | 32+ bytes | Secure random string |

---

## 8. Deployment Architecture

### 8.1 Deployment Options

| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| Docker | Containerized deployment | Consistent environment, easy scaling | Requires Docker expertise |
| PM2 | Node.js process manager | Simple, built-in logging | Manual scaling |
| Kubernetes | Orchestrated containers | Auto-scaling, self-healing | Complex setup |

### 8.2 Performance Baseline

| Metric | Expected Value | Monitoring |
|--------|----------------|------------|
| Response Time (p95) | < 500ms | Datadog / New Relic |
| Response Time (p99) | < 1000ms | Datadog / New Relic |
| Concurrent Requests | 100+ | Load testing |
| Error Rate | < 1% | Error tracking |
| Uptime | 99.9% | Monitoring alerts |

---

## 9. Error Handling Strategy

### 9.1 Error Response Format

```json
{
  "error": "Human-readable error message",
  "requestId": "req-20260617-abc123",
  "timestamp": "2026-06-17T10:00:00.000Z",
  "code": "ERR_001"
}
```

### 9.2 Error Categories

| Code Range | Category | Description |
|------------|----------|-------------|
| 4xx | Client Errors | Invalid requests, authentication failures |
| 5xx | Server Errors | Internal server errors, dependency failures |
| ERR_xxx | Application Errors | Custom application-level errors |

### 9.3 Common Error Codes

| HTTP Status | Error | Description | Resolution |
|-------------|-------|-------------|------------|
| 400 | ERR_VALIDATION | Request validation failed | Check request body/params |
| 401 | ERR_UNAUTHORIZED | Missing or invalid token | Provide valid JWT token |
| 403 | ERR_FORBIDDEN | Insufficient permissions | Check user role or group access |
| 404 | ERR_NOT_FOUND | Resource not found | Verify resource ID |
| 500 | ERR_INTERNAL | Internal server error | Check server logs |
| 502 | ERR_BAD_GATEWAY | Upstream service error | Check Traccar/MSPF server |
| 504 | ERR_TIMEOUT | Request timeout | Increase timeout value |

---

## 10. Development Implementation Steps (Phase 1)

| Step | Action | Description |
|------|--------|-------------|
| 1 | **Initialize Gateway Auth DB** | Set up PostgreSQL/MySQL with the `users` table. Create an initial seeder for the Admin account |
| 2 | **Auth Module** | Implement login route, bcrypt verification, and JWT generation |
| 3 | **User Management** | Implement `GET /api/users`, `GET /api/users/:id`, `PUT /api/users/:id/groups` for admin to assign group/BC access to customers |
| 4 | **Group Aggregator** | Implement `GET /api/groups` fetching from Traccar (`GET /groups`) and MSPF (`GET /v2/bc`), merge with composite IDs |
| 5 | **Device Proxy & Cache** | Implement `GET /api/devices`. On cache MISS, fetch from both backends, merge, store in cache. Maintain device→source mapping |
| 6 | **Command Router** | Route commands based on `source`, `group`, or device-source cache lookup |
| 7 | **Activation Proxy** | Proxy MSPF activation (`PUT /v3/devices/{id}/activation`) through `PUT /api/devices/:id/activation` |
| 8 | **WebSocket Bridge** | Initialize Socket.io server. Connect to Traccar WS client, setup MSPF Polling interval, and emit normalized data |

---

## 11. Testing Strategy

### 11.1 Test Types

| Type | Purpose | Tools |
|------|---------|-------|
| Unit Tests | Test individual components | Jest / Mocha |
| Integration Tests | Test API endpoints with mocks | Supertest |
| E2E Tests | Full system tests | Cypress / Playwright |
| Load Tests | Performance under load | Artillery / k6 |

### 11.2 Test Coverage Requirements

| Component | Minimum Coverage |
|-----------|-----------------|
| Services (Traccar/MSPF) | 80% |
| Routes (API endpoints) | 90% |
| Middleware (Auth) | 95% |
| Utils (Helpers) | 80% |
| Overall | 80% |

### 11.3 CI/CD Pipeline

```
Git Push
    │
    ▼
Lint & Format Check
    │
    ▼
Unit Tests Run
    │
    ▼
Integration Tests Run
    │
    ▼
Build Docker Image
    │
    ▼
Deploy to Staging
    │
    ▼
Smoke Tests Pass
    │
    ▼
Deploy to Production
```

---

## 12. Known Limitations

| Limitation | Impact | Mitigation |
|------------|--------|------------|
| No Data Sync | Data in two systems remains separate | Gateway handles routing, no sync needed |
| Event-Driven Features | Some Traccar features may not propagate | Event forwarding can be implemented via webhooks |
| Real-time vs Polling | Positions are as fresh as backend provides | Implement WebSocket for real-time updates |
| MSPF API Constraints | Dependent on MSPF API capabilities | Adapter pattern abstracts differences |
| Command Limitations | Different command sets per system | Discovery endpoint available for clients |
| ID Overlap Risk | Traccar and MSPF may have duplicate device IDs | Gateway maintains device→source mapping cache |

---

## 13. Glossary

| Term | Definition |
|------|------------|
| API Gateway | Single entry point for API requests that routes to appropriate backend services |
| BC | Business Unit in MSPF, equivalent to Group in Traccar |
| BFF | Backend for Frontend - pattern where backend is tailored for specific frontend needs |
| Composite ID | Unified identifier format: `traccar_{id}` or `mspf_{id}` |
| Gateway | The middleware application (this project) |
| MCCS | MSPF-specific data model for certain device types |
| MSPF | Multi-Sensor Processing Framework - the proprietary GPS tracking system |
| M2M | Machine-to-machine communication (Gateway to Backend services) |
| Traccar | Open-source GPS tracking system used as one of the backends |

---

## 14. References

### 14.1 External Documentation

| Resource | URL |
|----------|-----|
| Traccar API Documentation | https://www.traccar.org/api-documentation/ |
| Express.js Documentation | https://expressjs.com/ |
| Node.js Documentation | https://nodejs.org/ |
| Socket.io Documentation | https://socket.io/docs/ |
| Redis Documentation | https://redis.io/documentation |

### 14.2 Internal Documentation

| Document | Description |
|----------|-------------|
| USER_GUIDE.md | Simplified guide for end users (admin & customer) |
| Deployment Guide | Step-by-step deployment instructions |
| Troubleshooting Guide | Common issues and solutions |
