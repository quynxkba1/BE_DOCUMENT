# Backend Interview Questions — Junior Level

> Focus: fundamentals, REST basics, SQL, clean code, simple debugging.
> Key signal: clear thinking and eagerness to learn.

---

## REST & API Basics

1. **What is REST and what makes an API RESTful?**
   - **REST** stands for **Representational State Transfer**. It is an architectural style for designing APIs around resources.
   - A **resource** is something the API exposes, such as users, products, orders, posts, or payments.
   - A RESTful API usually represents resources with clear URLs:
     - `GET /users`
     - `GET /users/123`
     - `POST /users`
     - `PUT /users/123`
     - `DELETE /users/123`
   - What makes an API RESTful:
     - **Resource-based URIs:** URLs should describe resources, not actions.
       - Good: `GET /users/123`
       - Less RESTful: `GET /getUserById?id=123`
     - **Standard HTTP methods:** use the HTTP method to describe the action.
       - `GET` reads data.
       - `POST` creates or triggers a new operation.
       - `PUT` replaces a resource.
       - `PATCH` partially updates a resource.
       - `DELETE` removes a resource.
     - **Stateless requests:** each request must contain enough information for the server to handle it. The server should not rely on previous requests stored in server-side session state.
       - Example: the client sends an access token on every request.
     - **Consistent response format:** APIs commonly return JSON.
     - **Proper HTTP status codes:** use status codes to communicate the result.
       - `200 OK` for successful reads/updates.
       - `201 Created` for successful creation.
       - `400 Bad Request` for invalid input.
       - `401 Unauthorized` when authentication is missing or invalid.
       - `404 Not Found` when the resource does not exist.
   - Example:
     ```http
     GET /users/123
     ```
     Response:
     ```json
     {
       "id": 123,
       "name": "Alice",
       "email": "alice@example.com"
     }
     ```
   - A good junior-level answer:
     > REST is a way to design APIs around resources. A RESTful API uses resource-based URLs, standard HTTP methods, stateless requests, JSON responses, and proper HTTP status codes.

2. **What is the difference between GET, POST, PUT, PATCH, DELETE?**
   - These are common HTTP methods. Each method communicates the intention of the request.

   | Method | Purpose | Example | Has request body? | Idempotent? |
   | ------ | ------- | ------- | ----------------- | ----------- |
   | `GET` | Read data | `GET /users/123` | Usually no | Yes |
   | `POST` | Create a new resource or trigger an action | `POST /users` | Yes | Usually no |
   | `PUT` | Replace an entire resource | `PUT /users/123` | Yes | Yes |
   | `PATCH` | Partially update a resource | `PATCH /users/123` | Yes | Usually yes, but depends on design |
   | `DELETE` | Delete a resource | `DELETE /users/123` | Usually no | Yes |

   - **GET**
     - Used to retrieve data.
     - Should not change server state.
     - Example:
       ```http
       GET /products/10
       ```
     - Calling it many times should return the same result if the data has not changed.

   - **POST**
     - Usually used to create a new resource.
     - Not idempotent by default.
     - Example:
       ```http
       POST /orders
       ```
       Body:
       ```json
       {
         "productId": 10,
         "quantity": 2
       }
       ```
     - If the client sends this request twice, it may create two different orders.
     - This is why `POST` is usually considered **not idempotent**.

   - **PUT**
     - Used to replace the full resource with the provided data.
     - Idempotent.
     - Example:
       ```http
       PUT /users/123
       ```
       Body:
       ```json
       {
         "name": "Alice Nguyen",
         "email": "alice@example.com"
       }
       ```
     - Sending the same `PUT` request multiple times leaves the resource in the same final state.

   - **PATCH**
     - Used to update part of a resource.
     - Example:
       ```http
       PATCH /users/123
       ```
       Body:
       ```json
       {
         "name": "Alice Nguyen"
       }
       ```
     - Only the `name` changes. Other fields remain unchanged.
     - `PATCH` can be idempotent if designed carefully, but not every `PATCH` operation is idempotent.
       - Idempotent: set `name` to `"Alice Nguyen"`.
       - Not idempotent: increment `loginCount` by `1`.

   - **DELETE**
     - Used to remove a resource.
     - Idempotent.
     - Example:
       ```http
       DELETE /users/123
       ```
     - If the user is deleted once, calling the same delete again does not delete anything new. The final state is still "user does not exist."

   - **Idempotency**
     - An operation is **idempotent** if making the same request multiple times has the same final effect as making it once.
     - Examples:
       - `GET /users/123` is idempotent because it only reads data.
       - `PUT /users/123` with the same body is idempotent because the final user data is the same.
       - `DELETE /users/123` is idempotent because the final state is still deleted.
       - `POST /orders` is usually not idempotent because repeated calls can create multiple orders.

   - A good junior-level answer:
     > GET reads data, POST usually creates data, PUT replaces a full resource, PATCH updates part of a resource, and DELETE removes a resource. GET, PUT, and DELETE are idempotent because repeating the same request leads to the same final state. POST is usually not idempotent because repeating it can create multiple records.

3. **What is a reverse proxy and what is it used for?**
   - Load balancing, SSL termination, caching — nginx is a common example

4. **What is the difference between authentication and authorization?**
   - Auth = who you are, Authz = what you can do

5. **What is a status code? Explain 200, 201, 400, 401, 403, 404, 500.**
   - Group by 2xx success, 4xx client error, 5xx server error

---

## Database Fundamentals

1. **What is the difference between SQL and NoSQL?**
   - Structured/ACID vs flexible/scalable — relate to use cases like e-commerce vs social feeds

2. **What are ACID properties?**
   - Atomicity, Consistency, Isolation, Durability — give a banking transaction example

3. **What is a JOIN? Explain INNER, LEFT, RIGHT JOIN.**
   - LEFT JOIN returns all from left table even without a match

4. **What is the difference between WHERE and HAVING?**
   - WHERE filters rows, HAVING filters grouped results

5. **What is an index in a database and why use it?**
   - Speeds up reads, slows down writes — e.g. add index on email for login queries

---

## Programming Basics

1. **What is the difference between a process and a thread?**
   - Process has its own memory space; threads share process memory

2. **What is async/await and how does it differ from callbacks?**
   - Avoids callback hell, makes async code look synchronous

3. **What is the difference between stack and heap memory?**
   - Stack = function calls/local vars (auto-managed), heap = objects (GC-managed)

4. **Explain OOP: encapsulation, inheritance, polymorphism.**
   - Give one real code example for each

5. **What is the difference between acceptance test and functional test?**
   - Acceptance = did we build the right thing? Functional = did we build it correctly?

---

## Basic Security

1. **What is SQL injection and how do you prevent it?**
   - Use parameterized queries / prepared statements — never concatenate user input

2. **What is HTTPS and why is it important?**
   - TLS encrypts data in transit — prevents eavesdropping and man-in-the-middle attacks

3. **How do you store passwords securely?**
   - bcrypt or argon2 with salt — never plain text or MD5/SHA1

---

## Infrastructure Intro

1. **What is containerization and what problem does Docker solve?**
   - "Works on my machine" — Docker packages app + dependencies together

2. **What is the difference between CI, CD (delivery), and CD (deployment)?**
   - CI = merge + test, CD delivery = automate release, CD deployment = push to prod automatically
