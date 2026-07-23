# Answers — Reverse Proxy

---

## 1. What is a reverse proxy and what is it used for?

A **reverse proxy** sits between external clients and your backend servers. Clients talk to the proxy first. The proxy then forwards the request to the correct backend server.

```text
Client
  -> Reverse Proxy: Nginx / Caddy / AWS ALB
  -> Backend Server 1
  -> Backend Server 2
  -> Backend Server 3
```

The client usually does not know which backend server handled the request.

Simple example:

```text
Browser calls https://api.example.com/users
Nginx receives the request
Nginx forwards it to http://127.0.0.1:3000/users
Node.js API handles the request
Nginx sends the response back to the browser
```

---

## 2. Why use a reverse proxy?

### Load balancing

A reverse proxy can distribute traffic across multiple backend instances.

```text
Request 1 -> API server A
Request 2 -> API server B
Request 3 -> API server C
```

This improves scalability and availability.

### SSL/TLS termination

The reverse proxy can handle HTTPS certificates.

```text
Client -> HTTPS -> Nginx -> HTTP -> Backend API
```

Benefit:

```text
certificate management is centralized
backend services do not need to manage TLS directly
```

### Routing

A reverse proxy can route requests based on host or path.

Examples:

```text
api.example.com          -> backend API
admin.example.com        -> admin frontend
example.com/static       -> static files
example.com/api          -> backend API
```

### Caching

The proxy can cache static assets or cacheable API responses.

Example:

```text
GET /products
Nginx caches response for 60 seconds
next request can be served from cache
```

This reduces backend load.

### Rate limiting

The proxy can reject clients that send too many requests.

Example:

```text
maximum 100 requests per minute per IP
```

This helps protect the API from abuse or traffic spikes.

### Security boundary

The proxy can hide internal backend servers from the public internet.

Public:

```text
https://api.example.com
```

Internal:

```text
http://10.0.1.20:3000
http://10.0.1.21:3000
```

The client only sees the public domain.

---

## 3. Forward proxy vs reverse proxy

| Type | Sits in front of | Main purpose | Example |
|---|---|---|---|
| Forward proxy | Clients | Helps clients access the internet | Company proxy, VPN |
| Reverse proxy | Servers | Protects and routes traffic to backend servers | Nginx, Caddy, AWS ALB |

Forward proxy:

```text
Client -> Forward Proxy -> Internet
```

Reverse proxy:

```text
Internet -> Reverse Proxy -> Backend Servers
```

Short interview answer:

```text
A forward proxy represents the client.
A reverse proxy represents the server side.
```

---

## 4. Reverse proxy with Docker

In Docker projects, a reverse proxy is often used to expose one public port and route traffic to internal containers.

Example:

```text
Browser -> localhost:80 -> Nginx container -> API container:3000
```

Compose-style idea:

```yaml
services:
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"

  api:
    build: .
    expose:
      - "3000"
```

Meaning:

```text
Nginx is public through host port 80.
API is internal inside the Docker network.
Nginx forwards requests to api:3000.
```

Important:

```text
Inside Docker Compose, use service names such as api:3000.
Do not use localhost:3000 from Nginx container to reach API container.
```

---

## 5. Common Nginx reverse proxy example

Example config:

```nginx
server {
    listen 80;
    server_name api.example.com;

    location / {
        proxy_pass http://api:3000;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

What it means:

| Config | Meaning |
|---|---|
| `listen 80` | Nginx listens on port 80 |
| `server_name api.example.com` | Handles requests for this domain |
| `proxy_pass http://api:3000` | Forwards request to API service |
| `X-Real-IP` | Sends real client IP to backend |
| `X-Forwarded-For` | Keeps proxy chain of client IPs |
| `X-Forwarded-Proto` | Tells backend whether original request was HTTP or HTTPS |

---

## 6. What happens to the real client IP?

Without proxy headers, the backend may only see the proxy's IP.

Example:

```text
Client IP: 14.160.10.20
Nginx IP: 172.18.0.2
Backend sees: 172.18.0.2
```

To preserve the real client IP, the proxy sends headers:

```text
X-Real-IP: 14.160.10.20
X-Forwarded-For: 14.160.10.20
```

Backend frameworks usually need configuration to trust proxy headers.

Example in Express/NestJS:

```ts
app.set('trust proxy', true);
```

Use this carefully. Only trust proxy headers when the app is actually behind a trusted proxy.

---

## 7. Common reverse proxy errors

### `502 Bad Gateway`

Meaning:

```text
Reverse proxy cannot get a valid response from upstream backend.
```

Common causes:

```text
backend container is down
backend port is wrong
backend crashed
proxy_pass points to wrong host
Docker service name is wrong
```

Check:

```bash
docker ps
docker logs nginx
docker logs api
```

### `504 Gateway Timeout`

Meaning:

```text
Reverse proxy connected to backend, but backend took too long to respond.
```

Common causes:

```text
slow database query
backend overloaded
long-running request
upstream timeout too short
```

### Redirect loop

Common cause:

```text
proxy terminates HTTPS
backend thinks original request was HTTP
backend redirects to HTTPS again and again
```

Fix:

```text
set X-Forwarded-Proto
configure backend to trust proxy
```

---

## 8. Interview questions and answers

### Q1. What is a reverse proxy?

A reverse proxy is a server that receives client requests and forwards them to backend servers. It sits in front of the backend system.

### Q2. Why use Nginx in front of Node.js?

Nginx can handle HTTPS, static files, buffering, compression, rate limiting, routing, and load balancing. Node.js can focus on application logic.

### Q3. What is SSL termination?

SSL termination means HTTPS is decrypted at the reverse proxy. The proxy then forwards traffic to backend services, often over internal HTTP.

### Q4. What is load balancing?

Load balancing distributes requests across multiple backend instances so one server does not handle all traffic.

### Q5. What is `X-Forwarded-For`?

It is an HTTP header used by proxies to pass the original client IP address to the backend server.

### Q6. What causes `502 Bad Gateway`?

Usually the reverse proxy cannot reach the backend, the backend crashed, the backend port is wrong, or the upstream returned an invalid response.

### Q7. What is the difference between reverse proxy and API gateway?

A reverse proxy mainly forwards and routes traffic. An API gateway usually adds API-specific responsibilities such as authentication, rate limiting, request transformation, service discovery, analytics, and version routing.

### Q8. Does a reverse proxy replace application security?

No. A reverse proxy can add security controls, but the backend must still validate authentication, authorization, input data, and business rules.

---

## 9. Short summary

```text
A reverse proxy sits in front of backend servers.
It receives client traffic and forwards it to the correct internal service.
```

Common uses:

```text
load balancing
SSL termination
routing
caching
rate limiting
security boundary
```

Short interview answer:

> A reverse proxy is a server like Nginx that sits in front of backend servers. Clients send requests to the proxy, and the proxy forwards them to the correct backend. It is commonly used for load balancing, SSL termination, routing, caching, rate limiting, and hiding internal services from the public internet.
