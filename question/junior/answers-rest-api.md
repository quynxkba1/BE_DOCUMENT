# Answers — RESTful API Basics

---

## 1. What is REST and what makes an API RESTful?

REST (Representational State Transfer) is an architectural style for designing network APIs around **resources**. It is not a protocol or a library — it is a set of constraints.

### Core constraints

| Constraint | Meaning |
|---|---|
| **Stateless** | Each request must carry all context (e.g. token). The server holds no session between requests. |
| **Resource-based URIs** | URLs identify nouns (resources), not verbs (actions). |
| **Uniform interface** | Use HTTP methods as intended: GET reads, POST creates, etc. |
| **Client-server** | UI and backend are decoupled and communicate only via the API contract. |
| **Cacheable** | Responses must indicate whether they can be cached (`Cache-Control`, `ETag`). |
| **Layered system** | The client does not know if it is talking to the real server or a proxy/gateway. |

### Resource-based URL examples

```
Good (resource-based)       Less RESTful (action-based)
GET /users/123              GET /getUserById?id=123
POST /users                 POST /createUser
DELETE /users/123           POST /deleteUser?id=123
```

### What makes an API RESTful — checklist

1. Resource URLs (nouns, not verbs).
2. Correct HTTP methods (GET/POST/PUT/PATCH/DELETE).
3. Stateless requests (no server-side sessions; client sends auth token every time).
4. Consistent response format (usually JSON).
5. Proper HTTP status codes.

### RESTful API best-practice plan

When designing a real backend RESTful API, use this plan:

| Step | Best practice | Example |
|---|---|---|
| 1 | Identify resources as nouns | `users`, `orders`, `products`, `payments` |
| 2 | Use plural resource names | `/orders`, not `/order` |
| 3 | Use HTTP methods for actions | `POST /orders`, not `POST /createOrder` |
| 4 | Use path params for resource identity | `/orders/ord_789` |
| 5 | Use query params for filter/sort/pagination | `/orders?status=pending&page=1&limit=20` |
| 6 | Use request body for create/update data | JSON body in `POST`, `PUT`, `PATCH` |
| 7 | Return correct status code | `201` for created, `204` for no body |
| 8 | Keep response format consistent | `{ "data": ... }` or `{ "error": ... }` |
| 9 | Return safe error messages | Do not expose stack traces |
| 10 | Document request, response, and errors | Make API predictable for frontend/mobile clients |

Good resource naming:

```text
GET    /users
GET    /users/123
POST   /users
PATCH  /users/123
DELETE /users/123
```

Bad resource naming:

```text
GET  /getUsers
POST /createUser
POST /updateUser
POST /deleteUser
```

For nested resources, use nesting only when the relationship is important:

```text
GET  /users/123/orders
POST /users/123/orders
GET  /orders/ord_789
```

Avoid very deep nesting:

```text
Bad:
/companies/1/departments/2/users/3/orders/4/items/5
```

Prefer:

```text
/orders/4/items
```

### Example

Request:
```http
GET /users/123
Authorization: Bearer <token>
```

Response `200 OK`:
```json
{
  "id": 123,
  "name": "Alice",
  "email": "alice@example.com"
}
```

### Good junior answer

> REST is an architectural style for designing APIs around resources. A RESTful API uses resource-based URLs, standard HTTP methods, stateless requests, consistent JSON responses, and proper HTTP status codes.

### Follow-up Q&A

**Q: Why does statelessness matter? What is the trade-off?**

Statelessness means any server can handle any request — no sticky sessions. This makes horizontal scaling simple. The trade-off is that each request carries more data (the token, context), and there is no built-in server-side session to revoke instantly.

**Q: Is `POST /sendEmail` RESTful?**

It is a grey area. Pure REST represents actions as resources: `POST /emails` (create an email resource that triggers sending). In practice, RPC-style action endpoints (`/sendEmail`, `/processPayment`) are common and pragmatic, but they are not strictly RESTful.

**Q: How does HTTP signal that a response is cacheable?**

Via headers: `Cache-Control: max-age=3600`, `ETag: "abc123"`, `Last-Modified: Tue, 03 Jun 2025 10:00:00 GMT`. The client can revalidate with `If-None-Match` or `If-Modified-Since`.

---

## 2. What is the difference between GET, POST, PUT, PATCH, DELETE?

### Summary table

| Method | Purpose | Has body? | Safe? | Idempotent? |
|---|---|---|---|---|
| `GET` | Read a resource | No | Yes | Yes |
| `POST` | Create a resource or trigger an action | Yes | No | No (usually) |
| `PUT` | Replace an entire resource | Yes | No | Yes |
| `PATCH` | Partially update a resource | Yes | No | Sometimes |
| `DELETE` | Remove a resource | No | No | Yes |

- **Safe** — the operation causes no state change on the server.
- **Idempotent** — calling the same operation N times gives the same final state as calling it once.

### GET

Retrieves data without changing server state. Must not have side effects.

```http
GET /products/10
```

Response `200 OK`:
```json
{ "id": 10, "name": "Widget", "price": 9.99 }
```

### POST

Creates a new resource or triggers an action. **Not idempotent** — sending the same request twice may create two records.

```http
POST /orders
Content-Type: application/json

{ "productId": 10, "quantity": 2 }
```

Response `201 Created`:
```json
{ "orderId": 55, "status": "pending" }
```

Sending this request twice creates `orderId: 55` and `orderId: 56` — two different orders.

Best practice for `POST` response:

```text
POST creates a resource:
  return 201 Created
  include Location header if possible
  return the created resource or useful representation

POST starts async work:
  return 202 Accepted
  return job id and current status
```

The response does not always need to include every field in the database. It should include the information the client needs next, especially server-generated fields:

```text
id
status
createdAt
computed total
next action link or resource URL
```

### PUT

Replaces the full resource. **Idempotent** — sending the same body twice leaves the resource in the same state.

```http
PUT /users/123
Content-Type: application/json

{ "name": "Alice Nguyen", "email": "alice@example.com" }
```

If you omit `email` in a PUT, the server replaces the resource — `email` would be lost. Use PATCH instead if you only want to update specific fields.

Best practice for `PUT` response:

```text
200 OK + updated full resource
or
204 No Content if the client does not need the updated body
```

### PATCH

Partially updates a resource. Only the provided fields change; other fields remain untouched.

```http
PATCH /users/123
Content-Type: application/json

{ "name": "Alice Nguyen" }
```

PATCH is **idempotent if it sets a value** (set `name` to `"Alice Nguyen"` is the same every time). PATCH is **not idempotent if it increments** (increment `loginCount` by 1 gives a different result each call).

Best practice for `PATCH` response:

```text
200 OK + updated useful representation
or
204 No Content if update succeeded and no body is needed
```

If the frontend needs the latest updated value immediately, return `200 OK` with the updated representation. If the client already knows the final state and only needs confirmation, `204 No Content` is fine.

### DELETE

Removes a resource. **Idempotent** — after the first call the resource is gone; subsequent calls find the same state: resource does not exist.

```http
DELETE /users/123
```

First call → `204 No Content`. Second call → `404 Not Found` (or `204` depending on API design). Either way the final state is the same: user 123 does not exist.

### Idempotency in depth

| Operation | Idempotent? | Why |
|---|---|---|
| `GET /users/123` | Yes | Only reads; no side effects |
| `PUT /users/123` with same body | Yes | Final resource state is always the same |
| `DELETE /users/123` | Yes | Resource ends up deleted regardless |
| `POST /orders` | No | Each call creates a new order |
| `PATCH /users/123 { loginCount: +1 }` | No | Counter increments each time |

### Good junior answer

> GET reads data, POST creates data, PUT replaces a full resource, PATCH updates part of a resource, DELETE removes a resource. GET, PUT, and DELETE are idempotent because repeating the same request leads to the same final state. POST is usually not idempotent because repeating it can create multiple records.

### Follow-up Q&A

**Q: If DELETE is idempotent, what status code should the second DELETE return — 200 or 404?**

Both are defensible. Returning `404` is technically accurate (the resource no longer exists). Returning `204 No Content` on every delete is also valid and simpler for clients. The key is to document and be consistent.

**Q: Can POST ever be idempotent?**

Yes, with an **idempotency key**. The client generates a unique key and sends it as a header (`Idempotency-Key: uuid`). The server caches the response for that key and returns the same result on retries without re-executing the operation. Stripe's payment API uses this pattern.

**Q: Why should GET not have a request body?**

Semantically, GET requests are meant to be bookmark-able and cache-friendly. Some HTTP proxies and servers strip or reject bodies on GET requests. Using query parameters (`GET /users?role=admin`) is the correct approach.

---

## 3. RESTful API standard example: input and output

A RESTful API should be predictable. The URL should represent a resource, the HTTP method should represent the action, the request body should be clear, and the response should use the correct status code.

Example resource:

```text
orders
```

Good RESTful endpoints:

```text
GET    /orders
GET    /orders/1001
POST   /orders
PATCH  /orders/1001
DELETE /orders/1001
```

Less RESTful endpoints:

```text
GET  /getOrderById?id=1001
POST /createOrder
POST /updateOrder
POST /deleteOrder
```

### Example: create an order

Input request:

```http
POST /orders
Content-Type: application/json
Authorization: Bearer <access_token>

{
  "customerId": "cus_123",
  "items": [
    {
      "productId": "prod_100",
      "quantity": 2
    },
    {
      "productId": "prod_200",
      "quantity": 1
    }
  ],
  "shippingAddress": {
    "line1": "123 Nguyen Trai",
    "city": "Ho Chi Minh City",
    "country": "VN"
  }
}
```

Successful output:

```http
HTTP/1.1 201 Created
Content-Type: application/json
Location: /orders/ord_789

{
  "data": {
    "id": "ord_789",
    "customerId": "cus_123",
    "status": "pending",
    "items": [
      {
        "productId": "prod_100",
        "quantity": 2,
        "unitPrice": 15.5
      },
      {
        "productId": "prod_200",
        "quantity": 1,
        "unitPrice": 30
      }
    ],
    "totalAmount": 61,
    "currency": "USD",
    "createdAt": "2026-06-26T10:30:00.000Z"
  }
}
```

Why this is RESTful:

| Part | Meaning |
|---|---|
| `POST /orders` | Create a new order resource |
| Request body | Contains the data needed to create the order |
| `201 Created` | Correct status code because a resource was created |
| `Location: /orders/ord_789` | Tells the client where the new resource is |
| Response body | Returns the created resource or useful representation |

Should `POST` return the whole created resource?

```text
Not always required.
But it is common and practical to return the created resource or a useful representation.
```

Return enough data for the client to continue without making another request:

```text
id
status
server-generated timestamps
computed fields
resource URL through Location header
```

For a small resource, returning the full created resource is usually fine. For a large resource, return the important fields and let the client call `GET /orders/ord_789` if it needs full detail.

### Example: validation error

Input request:

```http
POST /orders
Content-Type: application/json
Authorization: Bearer <access_token>

{
  "customerId": "cus_123",
  "items": []
}
```

Output:

```http
HTTP/1.1 422 Unprocessable Entity
Content-Type: application/json

{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed.",
    "details": [
      {
        "field": "items",
        "message": "Order must contain at least one item."
      }
    ]
  }
}
```

Why `422` instead of `400`:

```text
The JSON is valid.
The request shape is understandable.
But the business rule is invalid because items cannot be empty.
```

### Example: get one order

Input request:

```http
GET /orders/ord_789
Authorization: Bearer <access_token>
```

Successful output:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "data": {
    "id": "ord_789",
    "customerId": "cus_123",
    "status": "pending",
    "totalAmount": 61,
    "currency": "USD"
  }
}
```

Not found output:

```http
HTTP/1.1 404 Not Found
Content-Type: application/json

{
  "error": {
    "code": "ORDER_NOT_FOUND",
    "message": "Order was not found."
  }
}
```

### Example: list orders with pagination

Input request:

```http
GET /orders?page=1&limit=20&status=pending
Authorization: Bearer <access_token>
```

Output:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "data": [
    {
      "id": "ord_789",
      "status": "pending",
      "totalAmount": 61
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "totalItems": 1,
    "totalPages": 1
  }
}
```

Best practice:

```text
Use query parameters for filtering, sorting, and pagination.
Do not create action URLs like /getPendingOrders.
```

### Example: partial update

Input request:

```http
PATCH /orders/ord_789
Content-Type: application/json
Authorization: Bearer <access_token>

{
  "shippingAddress": {
    "line1": "456 Le Loi",
    "city": "Ho Chi Minh City",
    "country": "VN"
  }
}
```

Output:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "data": {
    "id": "ord_789",
    "status": "pending",
    "shippingAddress": {
      "line1": "456 Le Loi",
      "city": "Ho Chi Minh City",
      "country": "VN"
    }
  }
}
```

Should update responses include the whole updated resource?

```text
PATCH/PUT can return 200 OK with the updated resource.
PATCH/PUT can also return 204 No Content when no response body is needed.
```

Best practical rule:

| Case | Recommended response |
|---|---|
| Frontend needs updated data immediately | `200 OK` with updated representation |
| Update changes computed/server fields | `200 OK` with updated representation |
| Simple update and client already has data | `204 No Content` |
| Large resource and body is expensive | `204 No Content` or return only useful fields |

Example compact update response:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "data": {
    "id": "ord_789",
    "status": "pending",
    "updatedAt": "2026-06-26T10:45:00.000Z"
  }
}
```

This is still RESTful because the response is a representation of the updated resource, even if it does not include every database column.

### Example: delete

Input request:

```http
DELETE /orders/ord_789
Authorization: Bearer <access_token>
```

Output:

```http
HTTP/1.1 204 No Content
```

For `204`, do not return a response body.

### Recommended response format

A common standard is:

Successful response:

```json
{
  "data": {
    "id": "ord_789",
    "status": "pending"
  }
}
```

List response:

```json
{
  "data": [],
  "meta": {
    "page": 1,
    "limit": 20,
    "totalItems": 0,
    "totalPages": 0
  }
}
```

Error response:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed.",
    "details": []
  }
}
```

Good API response rules:

- Keep response format consistent.
- Use `data` for successful payloads.
- Use `meta` for pagination or extra response metadata.
- Use `error` for failed requests.
- Do not expose internal stack traces to clients.
- Use stable error codes such as `VALIDATION_ERROR`, `ORDER_NOT_FOUND`, or `UNAUTHORIZED`.
- Do not return sensitive fields such as password hashes, reset tokens, internal flags, or private system metadata.
- Do not expose every database column by default; return an API representation designed for the client.

### RESTful API sample contract

This is a concise API contract style you can use in interviews or real projects.

Resource:

```text
orders
```

Endpoints:

| Method | Endpoint | Purpose | Success status |
|---|---|---|---|
| `GET` | `/orders` | List orders | `200 OK` |
| `GET` | `/orders/{id}` | Get one order | `200 OK` |
| `POST` | `/orders` | Create order | `201 Created` |
| `PATCH` | `/orders/{id}` | Partially update order | `200 OK` or `204 No Content` |
| `PUT` | `/orders/{id}` | Replace full order | `200 OK` or `204 No Content` |
| `DELETE` | `/orders/{id}` | Delete order | `204 No Content` |

Create request:

```http
POST /orders
Content-Type: application/json
Authorization: Bearer <access_token>

{
  "customerId": "cus_123",
  "items": [
    {
      "productId": "prod_100",
      "quantity": 2
    }
  ]
}
```

Create response:

```http
HTTP/1.1 201 Created
Location: /orders/ord_789
Content-Type: application/json

{
  "data": {
    "id": "ord_789",
    "customerId": "cus_123",
    "status": "pending",
    "totalAmount": 31,
    "currency": "USD",
    "createdAt": "2026-06-26T10:30:00.000Z"
  }
}
```

Update request:

```http
PATCH /orders/ord_789
Content-Type: application/json
Authorization: Bearer <access_token>

{
  "status": "cancelled"
}
```

Update response option 1:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "data": {
    "id": "ord_789",
    "status": "cancelled",
    "updatedAt": "2026-06-26T11:00:00.000Z"
  }
}
```

Update response option 2:

```http
HTTP/1.1 204 No Content
```

Error response:

```http
HTTP/1.1 422 Unprocessable Entity
Content-Type: application/json

{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed.",
    "details": [
      {
        "field": "items.0.quantity",
        "message": "Quantity must be greater than 0."
      }
    ]
  }
}
```

Short interview answer:

> A RESTful API should model resources with noun URLs, use HTTP methods correctly, return consistent JSON, and use proper status codes. For POST create, return `201 Created` with the created resource or useful representation. For updates, return `200 OK` with updated data when the client needs it, or `204 No Content` when no body is needed.

---

## 4. What is the difference between authentication and authorization?

| | Authentication (AuthN) | Authorization (AuthZ) |
|---|---|---|
| Question | Who are you? | What are you allowed to do? |
| Example | Login with email + password | Only admins can delete users |
| HTTP status on failure | `401 Unauthorized` | `403 Forbidden` |

### Flow example

```
1. User sends POST /login { email, password }
2. Server verifies credentials → issues JWT           ← Authentication
3. User sends DELETE /users/99 with JWT
4. Server verifies JWT is valid                       ← Authentication check
5. Server checks if user's role is "admin"            ← Authorization check
6. If not admin → 403 Forbidden
```

### Common mistake — wrong status code

- `401` = "I don't know who you are" (missing or invalid token).
- `403` = "I know who you are, but you don't have permission."

Returning `401` when a logged-in user accesses a forbidden resource is incorrect.

### Follow-up Q&A

**Q: What is the difference between JWT and session-based auth?**

| | Session | JWT |
|---|---|---|
| State | Server stores session in DB/Redis | Stateless — all data in the token |
| Revocation | Instant (delete session) | Hard — must wait for expiry or use a blocklist |
| Scale | Requires shared session store | Any server can verify the token |

**Q: What is OAuth and where does it fit?**

OAuth 2.0 is an **authorization framework** (not authentication) that allows a user to grant a third-party application limited access to their account without sharing their password. Example: "Sign in with Google" delegates authentication to Google; your app receives a token scoped to specific permissions.

---

## 5. What is a status code? Explain status-code best practices.

HTTP status codes are 3-digit numbers in responses that communicate the result of the request.

### Groups

| Range | Category | Meaning |
|---|---|---|
| 2xx | Success | Request was received, understood, and processed |
| 3xx | Redirection | Client must take further action (follow redirect) |
| 4xx | Client Error | The client sent a bad request |
| 5xx | Server Error | The server failed to fulfill a valid request |

### Quick reference

#### 2xx — Success

| Code | Name | When to use |
|---|---|---|
| `200` | OK | Standard success response. Use when the request was received, understood, and completed successfully. Most common for `GET` requests. |
| `201` | Created | A new resource was successfully created, usually after `POST`, such as creating a user or order. |
| `202` | Accepted | The request was accepted but processing is not finished yet. Use for async jobs such as email, video processing, or report exports. |
| `204` | No Content | Success, but nothing is returned. Use for `DELETE`, `PUT`, or `PATCH` when the operation succeeded but there is no body to send back. |

#### 3xx — Redirection

| Code | Name | When to use |
|---|---|---|
| `301` | Moved Permanently | The resource has a new permanent URL. Use for SEO-friendly redirects or when an endpoint is permanently deprecated. |
| `302` | Found | Temporary redirect. Use when the resource is temporarily available at a different URL. |
| `304` | Not Modified | Use for caching. The resource has not changed since the client's last request, so no body is sent. |

#### 4xx — Client errors

| Code | Name | When to use |
|---|---|---|
| `400` | Bad Request | The request is malformed or invalid, such as missing fields, wrong data types, invalid JSON, or structural problems. |
| `401` | Unauthorized | The user is not authenticated. Use when token or credentials are missing, expired, or invalid. |
| `403` | Forbidden | The user is authenticated but does not have permission to access this resource or action. |
| `404` | Not Found | The resource does not exist. Use when an ID or path points to nothing. |
| `405` | Method Not Allowed | The endpoint exists but does not support that HTTP method, such as sending `DELETE` to a read-only endpoint. |
| `409` | Conflict | The request conflicts with the current resource state, such as duplicate email or editing a stale version. |
| `422` | Unprocessable Entity | The request is well-formed but fails validation or business logic, such as `startDate > endDate`. |
| `429` | Too Many Requests | Rate limit exceeded. Use when throttling clients that send too many requests in a short period. |

#### 5xx — Server errors

| Code | Name | When to use |
|---|---|---|
| `500` | Internal Server Error | Generic catch-all for unexpected server failures. Use when something breaks that is not the client's fault. |
| `502` | Bad Gateway | The server received an invalid response from an upstream service, such as a microservice or third-party API. |
| `503` | Service Unavailable | The server is temporarily unable to handle requests, such as during maintenance or overload. |
| `504` | Gateway Timeout | An upstream service took too long to respond. |

Quick rule of thumb:

```text
4xx = the client did something wrong.
5xx = the server or upstream system did something wrong.
```

When choosing between `400` and `422`:

```text
400 = structural/parsing issue.
422 = validation/business rule failure.
```

### Common success codes

#### `200 OK`

Use for successful read or update requests that return a body.

Examples:

```text
GET /users/123        -> 200 OK
PATCH /users/123      -> 200 OK
PUT /users/123        -> 200 OK
```

Response:

```json
{
  "data": {
    "id": 123,
    "name": "Alice"
  }
}
```

#### `201 Created`

Use when a new resource is created.

Example:

```text
POST /users -> 201 Created
```

Best practice:

```http
HTTP/1.1 201 Created
Location: /users/123
```

Response:

```json
{
  "data": {
    "id": 123,
    "name": "Alice"
  }
}
```

#### `202 Accepted`

Use when the request is accepted but processing is not finished yet.

Good examples:

```text
POST /video-processing-jobs
POST /email-jobs
POST /reports/export-jobs
```

Response:

```json
{
  "data": {
    "jobId": "job_123",
    "status": "queued"
  }
}
```

Use `202` for queue-based or asynchronous work.

#### `204 No Content`

Use when the request succeeded but there is no response body.

Good examples:

```text
DELETE /users/123 -> 204 No Content
PUT /users/123    -> 204 No Content if API chooses not to return updated body
```

Important:

```text
204 response should not include JSON body.
```

### Common redirection codes

#### `301 Moved Permanently`

Use when a resource has permanently moved to a new URL.

Example:

```http
HTTP/1.1 301 Moved Permanently
Location: /v2/users/123
```

Good use cases:

```text
old endpoint permanently replaced
old public URL changed
SEO-friendly permanent redirect
```

Be careful with APIs: clients may cache `301` aggressively. Use it only when the move is truly permanent.

#### `302 Found`

Use when redirecting temporarily.

Example:

```http
HTTP/1.1 302 Found
Location: /temporary-login-page
```

Good use cases:

```text
temporary maintenance page
temporary login redirect
short-term route change
```

#### `304 Not Modified`

Use for HTTP caching. It tells the client that the cached copy is still valid, so the server does not send the body again.

Example flow:

```http
GET /products/123
If-None-Match: "product-123-v1"
```

Response:

```http
HTTP/1.1 304 Not Modified
ETag: "product-123-v1"
```

Meaning:

```text
Client already has the latest version.
Server saves bandwidth by not sending the response body.
```

### Common client error codes

#### `400 Bad Request`

Use when the request is malformed or cannot be parsed.

Examples:

```text
invalid JSON
wrong Content-Type
query parameter has invalid type
required request body is missing
```

Example:

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Invalid JSON body."
  }
}
```

#### `401 Unauthorized`

Use when authentication is missing or invalid.

Examples:

```text
missing Authorization header
expired access token
invalid token signature
```

Example:

```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Authentication is required."
  }
}
```

#### `403 Forbidden`

Use when the user is authenticated but not allowed to perform the action.

Example:

```text
normal user tries to DELETE /users/123
```

Response:

```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "You do not have permission to perform this action."
  }
}
```

#### `404 Not Found`

Use when the resource does not exist or the API intentionally does not reveal whether it exists.

Example:

```text
GET /orders/unknown-id -> 404 Not Found
```

#### `405 Method Not Allowed`

Use when the route exists, but the HTTP method is not supported.

Example:

```text
GET /orders/ord_789 is supported.
DELETE /orders/ord_789 is not allowed for this user-facing API.
```

Response:

```http
HTTP/1.1 405 Method Not Allowed
Allow: GET, PATCH
Content-Type: application/json
```

```json
{
  "error": {
    "code": "METHOD_NOT_ALLOWED",
    "message": "This endpoint does not support DELETE."
  }
}
```

#### `409 Conflict`

Use when the request conflicts with current server state.

Good examples:

```text
register email that already exists
create username that already exists
update resource with old version number
```

Response:

```json
{
  "error": {
    "code": "EMAIL_ALREADY_EXISTS",
    "message": "Email already exists."
  }
}
```

#### `422 Unprocessable Entity`

Use when the request is valid JSON but fails validation or business rules.

Examples:

```text
email format is invalid
quantity must be greater than 0
endDate must be after startDate
items array cannot be empty
```

Response:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed.",
    "details": [
      {
        "field": "quantity",
        "message": "Quantity must be greater than 0."
      }
    ]
  }
}
```

#### `429 Too Many Requests`

Use when the client sends too many requests.

Example:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 60
```

Response:

```json
{
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many requests. Try again later."
  }
}
```

### Common server error codes

#### `500 Internal Server Error`

Use for unexpected server-side failures.

Examples:

```text
uncaught exception
unexpected null value
bug in server code
```

Do not expose internal details:

```json
{
  "error": {
    "code": "INTERNAL_SERVER_ERROR",
    "message": "Something went wrong."
  }
}
```

Bad:

```json
{
  "error": "TypeError: Cannot read property password of undefined at user.service.ts:55"
}
```

#### `502 Bad Gateway`

Usually returned by a gateway or reverse proxy when an upstream service responds incorrectly.

Example:

```text
Nginx forwards request to Node.js API.
Node.js API crashes or returns invalid response.
Nginx returns 502.
```

#### `503 Service Unavailable`

Use when the service is temporarily unavailable.

Examples:

```text
server overloaded
maintenance mode
database temporarily unavailable
```

Can include:

```http
Retry-After: 120
```

#### `504 Gateway Timeout`

Usually returned by a gateway, reverse proxy, or load balancer when an upstream service takes too long to respond.

Example:

```text
Client calls API gateway.
API gateway calls payment service.
Payment service does not respond before timeout.
API gateway returns 504 Gateway Timeout.
```

Common causes:

```text
slow upstream service
network issue
database query hanging in another service
third-party API timeout
timeout setting too short
```

### Status code decision examples

| Situation | Best status |
|---|---|
| Get user successfully | `200 OK` |
| Create user successfully | `201 Created` |
| Queue video processing job | `202 Accepted` |
| Delete user successfully with no body | `204 No Content` |
| Permanently redirect old endpoint | `301 Moved Permanently` |
| Temporarily redirect user | `302 Found` |
| Cached resource has not changed | `304 Not Modified` |
| Invalid JSON | `400 Bad Request` |
| Missing token | `401 Unauthorized` |
| Logged-in user lacks admin role | `403 Forbidden` |
| User id does not exist | `404 Not Found` |
| Endpoint exists but method is unsupported | `405 Method Not Allowed` |
| Email already exists | `409 Conflict` |
| Valid JSON but invalid business data | `422 Unprocessable Entity` |
| Client exceeds rate limit | `429 Too Many Requests` |
| Unexpected server bug | `500 Internal Server Error` |
| Proxy cannot reach upstream API | `502 Bad Gateway` |
| Server temporarily unavailable | `503 Service Unavailable` |
| Upstream service takes too long | `504 Gateway Timeout` |

### Status code best practices

1. Use status codes to describe the result, not only the response body.
2. Do not return `200 OK` for every response.
3. Use `201 Created` when a resource is created.
4. Use `202 Accepted` for async queue-based work.
5. Use `204 No Content` only when there is no response body.
6. Use `301` only for truly permanent redirects.
7. Use `302` for temporary redirects.
8. Use `304` when cache validation shows the resource has not changed.
9. Use `401` for missing/invalid authentication.
10. Use `403` for authenticated but forbidden.
11. Use `404` when the resource does not exist.
12. Use `405` when the endpoint exists but the method is unsupported.
13. Use `409` for duplicate or state conflict.
14. Use `422` for validation/business rule errors.
15. Use `429` for rate limiting.
16. Use `5xx` only when the server or upstream system failed.
17. Use `504` when an upstream dependency times out.
18. Keep error response structure consistent.
19. Log detailed server errors internally, but return safe messages to clients.
20. Document status codes in API documentation.

### 400 vs 422 distinction

- `400 Bad Request` — the request is malformed (invalid JSON, missing `Content-Type` header).
- `422 Unprocessable Entity` — the request is syntactically valid but the data fails business logic validation.

### Follow-up Q&A

**Q: When would you use 409 Conflict?**

When the request conflicts with the current state of the resource. Classic example: `POST /users` with an email that already exists in the database.

**Q: What is the difference between 401 and 403?**

`401` means the client is not authenticated — they need to log in. `403` means the client is authenticated but does not have permission. Confusing these leaks information: returning `404` instead of `403` is sometimes used intentionally to hide that a resource exists.
