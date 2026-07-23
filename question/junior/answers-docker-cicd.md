# Answers — Docker, Docker Compose, and CI/CD

This note is based on three source documents:

- Basic Docker: https://viblo.asia/p/docker-va-cac-kien-thuc-can-ban-BQyJKjEb4Me
- Docker Compose: https://viblo.asia/p/docker-compose-va-nhung-kien-thuc-co-ban-aNj4vzpv46r
- CI/CD with GitHub Actions: https://viblo.asia/p/cicd-github-actions-va-cac-kien-thuc-co-ban-EoW4oRMrVml

The goal is not to memorize commands. The goal is to understand how Docker, Compose, and CI/CD connect in a real backend project.

---

## 1. Why Docker Exists

The classic problem:

```text
It works on my machine, but not on your machine or production.
```

This happens because different machines may have:

- different Node.js versions
- different npm versions
- different OS packages
- different environment variables
- missing system dependencies
- different database/Redis/RabbitMQ setup

Docker solves this by packaging the application and its runtime dependencies into an **image**.

That image can run as a **container** on any machine with Docker installed.

```text
Developer laptop
CI server
Staging server
Production server

All run the same Docker image.
```

---

## 2. Virtualization vs Containerization

### Virtualization

Virtualization creates full virtual machines.

```text
Physical server
  -> VM 1: full OS + app
  -> VM 2: full OS + app
  -> VM 3: full OS + app
```

Each VM has its own operating system. This provides strong isolation, but it costs more CPU, memory, disk, and startup time.

Examples:

- VMware
- VirtualBox
- Hyper-V
- KVM

### Containerization

Containerization isolates applications at the operating-system level.

```text
Host OS kernel
  -> container 1: app + dependencies
  -> container 2: app + dependencies
  -> container 3: app + dependencies
```

Containers share the host OS kernel, so they are lighter and start faster than VMs.

Examples:

- Docker
- Podman
- Kubernetes

### Comparison

| | Virtual Machine | Container |
|---|---|---|
| Isolation level | Hardware/OS-level | Process/OS-level |
| OS | Each VM has full OS | Shares host kernel |
| Size | Large | Smaller |
| Startup | Slower | Faster |
| Use case | Full machine isolation | App packaging and deployment |

Short answer:

> A VM packages an entire operating system. A container packages an application and its dependencies while sharing the host OS kernel.

---

## 3. Docker Core Components

| Component | Meaning |
|---|---|
| Docker daemon | Background service that manages images, containers, networks, and volumes |
| Docker client | CLI or GUI used to talk to Docker daemon |
| Docker image | Read-only package containing app code, runtime, and dependencies |
| Docker container | Running instance of an image |
| Dockerfile | Recipe for building an image |
| Docker registry | Remote storage for images, such as Docker Hub, ECR, or GHCR |
| Docker network | Virtual network that lets containers communicate |
| Docker volume | Persistent storage managed by Docker |
| Docker Compose | Tool for running multiple containers from one YAML file |

Mental model:

```text
Dockerfile -> docker build -> image -> docker run -> container
```

---

## 4. Image vs Container

### Image

An image is the blueprint.

```text
my-api:1.0
  contains Node.js
  contains dependencies
  contains compiled app code
  contains startup command
```

It is read-only and can be pushed to a registry.

### Container

A container is a running instance of an image.

```text
container api-1 runs from image my-api:1.0
container api-2 runs from image my-api:1.0
```

You can run many containers from the same image.

Analogy:

```text
Image     = class / blueprint
Container = object / running instance
```

---

## 5. Basic Docker Commands

### Pull image

```bash
docker pull node:20-alpine
```

Downloads an image from a registry.

### List images

```bash
docker images
```

Shows images available on your machine.

### Run container

```bash
docker run --name my-api -p 3000:3000 -d my-api:1.0
```

Meaning:

```text
--name my-api     name the container
-p 3000:3000      map host port 3000 to container port 3000
-d                run in detached/background mode
my-api:1.0        image name and tag
```

### List running containers

```bash
docker ps
```

### List all containers

```bash
docker ps -a
```

### Stop container

```bash
docker stop my-api
```

### Remove container

```bash
docker rm my-api
```

### Remove image

```bash
docker rmi my-api:1.0
```

### Enter a running container

```bash
docker exec -it my-api /bin/sh
```

Meaning:

```text
docker exec    run a command inside a running container
-it            interactive terminal
/bin/sh        shell command
```

### View logs

```bash
docker logs -f my-api
```

### Build image

```bash
docker build -t my-api:1.0 .
```

Meaning:

```text
-t my-api:1.0  image name and tag
.              build context, current directory
```

### Push image

```bash
docker login
docker push username/my-api:1.0
```

Pushes the image to a registry so another machine can pull and run it.

---

## 6. A Basic Dockerfile for Node.js

Simple development-style Dockerfile:

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000

CMD ["npm", "run", "start:dev"]
```

Line by line:

```text
FROM node:20-alpine
  Use Node.js 20 Alpine image as the base runtime.

WORKDIR /app
  Set /app as the working directory inside the image.

COPY package*.json ./
  Copy package.json and package-lock.json first.

RUN npm install
  Install dependencies.

COPY . .
  Copy application source code.

EXPOSE 3000
  Document that the app listens on port 3000.

CMD ["npm", "run", "start:dev"]
  Start command when container runs.
```

This is acceptable for learning, but it is not ideal for production.

---

## 7. Production Dockerfile for a Backend API

Real production images should:

- install dependencies reproducibly
- build TypeScript before runtime
- exclude development dependencies from final image
- run as a non-root user
- contain only what is needed to run

Example:

```dockerfile
FROM node:20-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS builder

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY tsconfig*.json ./
COPY src ./src

RUN npm run build

FROM node:20-alpine AS prod-deps

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:20-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

USER node

COPY --chown=node:node --from=prod-deps /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/dist ./dist
COPY --chown=node:node package.json ./

EXPOSE 3000

CMD ["node", "dist/main.js"]
```

Why this is better:

```text
Builder stage:
  has TypeScript and build tools

Runtime stage:
  has only production dependencies and compiled output
```

Smaller image means:

- faster pull/deploy
- less disk usage
- fewer packages to scan
- smaller security attack surface

---

## 8. Docker Layer Caching

Docker builds images layer by layer.

Good order:

```dockerfile
COPY package.json package-lock.json ./
RUN npm ci
COPY src ./src
```

If only source code changes, Docker can reuse the dependency layer.

Bad order:

```dockerfile
COPY . .
RUN npm ci
```

Every source change invalidates the `COPY . .` layer, so Docker must reinstall dependencies.

Rule:

> Copy dependency files first, install dependencies, then copy source code.

---

## 9. `.dockerignore`

The Docker build context should not include unnecessary files.

Example:

```text
node_modules
dist
coverage
.git
.github
.env
.env.*
npm-debug.log
Dockerfile*
compose*.yml
README.md
```

Benefits:

- faster Docker builds
- smaller build context
- fewer accidental secret leaks
- better layer caching

Important:

```text
.dockerignore is like .gitignore, but for Docker build context.
```

---

## 10. Ports, Bind Mounts, and Volumes

### Port mapping

```bash
docker run -p 3000:3000 my-api
```

Meaning:

```text
host port 3000      -> container port 3000
localhost:3000      -> app inside container:3000
```

If you do not map the port, the app may run inside the container but not be reachable from your host machine.

### Bind mount for development

```bash
docker run --name my-api \
  -p 3000:3000 \
  -v $(pwd):/app \
  my-api
```

Meaning:

```text
current host folder -> /app inside container
```

When you edit code on the host, the container sees the change.

Use bind mounts for development, not for production.

### Docker volume

```bash
docker volume create pgdata
docker run -v pgdata:/var/lib/postgresql/data postgres:16
```

Meaning:

```text
Docker-managed storage -> PostgreSQL data directory
```

Use volumes for persistent service data such as database files.

---

## 11. Docker Compose

Docker Compose manages multiple containers from one YAML file.

Instead of running:

```bash
docker run api ...
docker run postgres ...
docker run redis ...
docker run rabbitmq ...
```

you define services in `compose.yml` and run:

```bash
docker compose up
```

Compose concepts:

| Concept | Meaning |
|---|---|
| `services` | Application components such as API, database, Redis |
| `networks` | Virtual networks for container communication |
| `volumes` | Persistent storage |
| `environment` | Environment variables |
| `ports` | Host-to-container port mapping |
| `depends_on` | Startup dependency order |
| `build` | Build image from local Dockerfile |
| `image` | Use existing image from registry |

---

## 12. Docker Compose Example for Backend Project

Example backend stack:

```yaml
services:
  api:
    build:
      context: .
      dockerfile: Dockerfile
      target: runtime
    image: my-api:local
    container_name: my-api
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: production
      DATABASE_URL: postgres://app:app_password@postgres:5432/app
      REDIS_URL: redis://redis:6379
      RABBITMQ_URL: amqp://app:app_password@rabbitmq:5672
    depends_on:
      - postgres
      - redis
      - rabbitmq
    networks:
      - app-network

  postgres:
    image: postgres:16-alpine
    container_name: my-postgres
    restart: unless-stopped
    ports:
      - "5432:5432"
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app_password
      POSTGRES_DB: app
    volumes:
      - postgres_data:/var/lib/postgresql/data
    networks:
      - app-network

  redis:
    image: redis:7-alpine
    container_name: my-redis
    restart: unless-stopped
    ports:
      - "6379:6379"
    networks:
      - app-network

  rabbitmq:
    image: rabbitmq:3-management-alpine
    container_name: my-rabbitmq
    restart: unless-stopped
    ports:
      - "5672:5672"
      - "15672:15672"
    environment:
      RABBITMQ_DEFAULT_USER: app
      RABBITMQ_DEFAULT_PASS: app_password
    volumes:
      - rabbitmq_data:/var/lib/rabbitmq
    networks:
      - app-network

volumes:
  postgres_data:
  rabbitmq_data:

networks:
  app-network:
```

Run:

```bash
docker compose up --build
```

Stop:

```bash
docker compose down
```

Stop and delete volumes:

```bash
docker compose down -v
```

Warning:

```text
docker compose down -v deletes persistent data in named volumes.
```

---

## 13. Compose Networking

Inside Docker Compose, services can reach each other by service name.

From the `api` container:

```text
postgres:5432
redis:6379
rabbitmq:5672
```

Do not use `localhost` to connect from one container to another.

Why:

```text
Inside api container:
localhost = api container itself
postgres  = PostgreSQL container
```

Correct:

```text
DATABASE_URL=postgres://app:app_password@postgres:5432/app
```

Wrong:

```text
DATABASE_URL=postgres://app:app_password@localhost:5432/app
```

`localhost` is only correct when the process you want is inside the same container.

---

## 14. Compose Volumes

Without volumes, database data can disappear when containers are removed.

Example:

```yaml
volumes:
  - postgres_data:/var/lib/postgresql/data
```

This means:

```text
PostgreSQL data directory inside container
  -> stored in Docker-managed named volume postgres_data
```

Now you can recreate the PostgreSQL container without losing data.

Use volumes for:

- PostgreSQL data
- MongoDB data
- RabbitMQ data
- local development data

Do not use application containers as storage.

Bad:

```text
store uploaded files inside API container
```

Better:

```text
store uploaded files in S3/object storage
store metadata in database
```

---

## 15. Environment Variables in Compose

You can define variables directly:

```yaml
environment:
  NODE_ENV: production
  DATABASE_URL: postgres://app:app_password@postgres:5432/app
```

Or use a `.env` file:

```text
APP_PORT=3000
POSTGRES_USER=app
POSTGRES_PASSWORD=app_password
POSTGRES_DB=app
```

Then reference it:

```yaml
ports:
  - "${APP_PORT}:3000"
environment:
  DATABASE_URL: postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}
```

Important:

```text
Do not commit real production secrets in .env files.
```

Use secret stores in CI/CD and production:

- GitHub Actions Secrets
- AWS Secrets Manager
- Doppler
- Vault
- Kubernetes Secrets with external secret manager

---

## 16. `depends_on` and Startup Order

Compose can start one service after another:

```yaml
depends_on:
  - postgres
```

But this does not always mean PostgreSQL is ready to accept queries.

Common problem:

```text
postgres container started
api container started
api tries to connect immediately
postgres is still initializing
api crashes
```

Better:

- add health checks
- add retry logic in the application
- avoid assuming dependencies are instantly ready

Example retry flow:

```text
API starts
  -> database connection fails
  -> wait 1s
  -> retry
  -> database ready
  -> API starts serving requests
```

---

## 17. CI/CD Basics

CI/CD means automating build, test, and deployment.

### CI: Continuous Integration

CI runs checks whenever code changes.

Typical CI:

```text
developer pushes code
  -> install dependencies
  -> lint
  -> run tests
  -> build app
  -> build Docker image
```

Goal:

```text
catch bugs before merge/deploy
```

### CD: Continuous Delivery

Continuous Delivery means every successful build is ready to deploy, but production deployment usually requires manual approval.

```text
merge to main
  -> CI passes
  -> image pushed
  -> deploy to staging
  -> engineer approves production deploy
```

### CD: Continuous Deployment

Continuous Deployment means every successful change is automatically deployed to production.

```text
merge to main
  -> CI passes
  -> deploy to production automatically
```

This requires strong tests, monitoring, rollback, and team maturity.

---

## 18. GitHub Actions Concepts

GitHub Actions lets you define automation workflows in YAML files.

Workflow location:

```text
.github/workflows/ci.yml
```

Core concepts:

| Concept | Meaning |
|---|---|
| `workflow` | Automation file |
| `on` | Event that triggers workflow |
| `jobs` | Groups of work |
| `steps` | Commands/actions inside a job |
| `runs-on` | Runner machine, such as Ubuntu |
| `uses` | Reuse an existing action |
| `run` | Execute shell command |
| `secrets` | Sensitive values stored by GitHub |

Example trigger:

```yaml
on:
  push:
    branches:
      - develop
  pull_request:
    branches:
      - develop
```

Meaning:

```text
Run pipeline when code is pushed to develop
or when a pull request targets develop.
```

---

## 19. Basic GitHub Actions CI Workflow

```yaml
name: Backend CI

on:
  pull_request:
    branches:
      - develop
  push:
    branches:
      - develop

jobs:
  build_and_test:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Lint
        run: npm run lint

      - name: Test
        run: npm test

      - name: Build application
        run: npm run build

      - name: Build Docker image
        run: docker build -t my-api:${{ github.sha }} .
```

Why `npm ci`?

```text
npm ci installs exactly from package-lock.json.
It is better for CI because builds are more reproducible.
```

Why `${{ github.sha }}`?

```text
It tags the Docker image with the commit SHA.
That links the image to exact source code.
```

---

## 20. CI/CD With Docker Registry and SSH Deploy

A simple beginner deployment flow:

```text
1. Push code to develop.
2. GitHub Actions runs tests.
3. GitHub Actions builds Docker image.
4. GitHub Actions logs in to Docker Hub.
5. GitHub Actions pushes image tagged with commit SHA.
6. GitHub Actions SSHs into server.
7. Server pulls the new image.
8. Server stops old container.
9. Server starts new container.
```

Example:

```yaml
name: Docker CI/CD Pipeline

on:
  push:
    branches:
      - develop

jobs:
  build_and_test:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Run tests
        run: npm test

      - name: Build application
        run: npm run build

      - name: Login to Docker Hub
        uses: docker/login-action@v3
        with:
          username: ${{ secrets.DOCKERHUB_USERNAME }}
          password: ${{ secrets.DOCKERHUB_TOKEN }}

      - name: Build and push image to Docker Hub
        uses: docker/build-push-action@v5
        with:
          context: .
          push: true
          tags: ${{ secrets.DOCKERHUB_USERNAME }}/my-api:${{ github.sha }}

  deploy:
    needs: build_and_test
    runs-on: ubuntu-latest

    steps:
      - name: Deploy to server
        uses: appleboy/ssh-action@v1.0.3
        with:
          host: ${{ secrets.SERVER_HOST }}
          username: ${{ secrets.SERVER_USER }}
          key: ${{ secrets.SSH_PRIVATE_KEY }}
          script: |
            docker pull ${{ secrets.DOCKERHUB_USERNAME }}/my-api:${{ github.sha }}
            docker stop my-api || true
            docker rm my-api || true
            docker run -d \
              --name my-api \
              -p 80:3000 \
              --restart unless-stopped \
              ${{ secrets.DOCKERHUB_USERNAME }}/my-api:${{ github.sha }}
```

Required GitHub secrets:

```text
DOCKERHUB_USERNAME
DOCKERHUB_TOKEN
SERVER_HOST
SERVER_USER
SSH_PRIVATE_KEY
```

This simple flow is useful for learning. In larger production systems, teams usually use Kubernetes, ECS, Nomad, ArgoCD, or another deployment platform instead of manual SSH commands.

---

## 21. What Actually Happens in the Pipeline

```text
Developer pushes code
  -> GitHub detects push event
  -> GitHub creates Ubuntu runner
  -> runner checks out source code
  -> runner installs dependencies
  -> runner runs tests
  -> runner builds Docker image
  -> runner authenticates to Docker Hub
  -> runner pushes image
  -> runner connects to server using SSH key
  -> server pulls image
  -> server replaces old container
```

Important:

```text
The GitHub runner is temporary.
Anything not pushed to a registry or artifact store disappears after the workflow finishes.
```

That is why the Docker image must be pushed to a registry before the deployment server can pull it.

---

## 22. Safer Production CI/CD Flow

For real production, improve the beginner flow:

```text
Pull request:
  -> lint
  -> unit tests
  -> integration tests
  -> build
  -> docker build

Merge to main:
  -> build image once
  -> tag image with commit SHA
  -> push image to registry
  -> deploy same image to staging
  -> run smoke tests
  -> manual approval
  -> deploy same image to production
  -> monitor logs and metrics
```

Key production rule:

> Build the image once, then promote the same image through staging and production.

Bad:

```text
build staging image
test staging image
build production image again
deploy production image
```

Why bad?

```text
The production image may not be exactly the same artifact tested in staging.
```

Better:

```text
build image api:git-a1b2c3d
deploy api:git-a1b2c3d to staging
deploy same api:git-a1b2c3d to production
```

---

## 23. Real Project Backend Flow

Suppose a NestJS API uses PostgreSQL and Redis.

### Local development

```text
docker compose up
  -> api
  -> postgres
  -> redis
```

Developer can test locally without manually installing PostgreSQL or Redis.

### Pull request

```text
developer opens PR
  -> CI installs dependencies
  -> CI runs lint
  -> CI runs unit tests
  -> CI starts PostgreSQL service
  -> CI runs integration tests
  -> CI builds app
  -> CI builds Docker image
```

### Merge and deploy

```text
merge to main
  -> build Docker image
  -> tag with commit SHA
  -> push to registry
  -> deploy to staging
  -> run migrations
  -> smoke test staging
  -> approve production
  -> deploy to production
```

### Rollback

```text
new version has errors
  -> deploy previous known-good image tag
  -> verify health checks
  -> inspect logs and metrics
```

---

## 24. Common Mistakes

### Mistake 1: Using `latest` in production

Bad:

```bash
docker run my-api:latest
```

Better:

```bash
docker run my-api:git-a1b2c3d
```

Reason:

```text
latest is mutable.
It does not clearly tell you which source code is running.
```

### Mistake 2: Putting secrets into Dockerfile

Bad:

```dockerfile
ENV JWT_SECRET=my-real-production-secret
```

Better:

```text
Inject secrets at runtime using secret manager or CI/CD secrets.
```

### Mistake 3: Using `localhost` between containers

Bad:

```text
DATABASE_URL=postgres://app:pass@localhost:5432/app
```

Better:

```text
DATABASE_URL=postgres://app:pass@postgres:5432/app
```

### Mistake 4: No persistent volume for database

Bad:

```text
database data only inside container writable layer
```

Better:

```yaml
volumes:
  - postgres_data:/var/lib/postgresql/data
```

### Mistake 5: Running dev command in production

Bad:

```dockerfile
CMD ["npm", "run", "start:dev"]
```

Better:

```dockerfile
CMD ["node", "dist/main.js"]
```

### Mistake 6: Deploying without tests

Bad:

```text
push code
deploy immediately
discover bug in production
```

Better:

```text
lint -> test -> build -> scan -> deploy
```

### Mistake 7: Stop old container before new one is ready

Simple SSH deployment often does:

```text
stop old container
remove old container
run new container
```

If new container fails, the app is down.

Safer approach:

```text
start new container on temporary port
run health check
switch traffic
stop old container
```

For production, use a platform that supports rolling/blue-green deployments.

---

## 25. Interview Questions and Answers

### Q1. What problem does Docker solve?

Docker packages an application with its runtime and dependencies so it runs consistently across machines. It reduces environment mismatch between developer machines, CI, staging, and production.

### Q2. What is the difference between an image and a container?

An image is a read-only blueprint. A container is a running instance of an image.

### Q3. What is a Dockerfile?

A Dockerfile is a set of instructions used to build a Docker image.

### Q4. What does `docker build -t my-api .` do?

It builds a Docker image from the Dockerfile in the current directory and tags it as `my-api`.

### Q5. What does `docker run -p 3000:3000 my-api` do?

It starts a container from the `my-api` image and maps host port `3000` to container port `3000`.

### Q6. What is the difference between `COPY` and a bind mount?

`COPY` copies files into the image at build time. A bind mount maps a host directory into a running container at runtime.

### Q7. What is a Docker volume?

A volume is Docker-managed persistent storage. It is commonly used for database data so data survives container replacement.

### Q8. What is Docker Compose?

Docker Compose is a tool for defining and running multiple containers using one YAML file.

### Q9. Why do containers in Compose use service names instead of localhost?

Each container has its own localhost. To reach another container, use the Compose service name, such as `postgres` or `redis`.

### Q10. What is CI?

Continuous Integration automatically runs checks such as lint, tests, and builds whenever code changes.

### Q11. What is CD?

CD can mean Continuous Delivery or Continuous Deployment. Delivery means the artifact is always deployable but production may need approval. Deployment means successful changes automatically go to production.

### Q12. What is GitHub Actions?

GitHub Actions is GitHub's automation platform for CI/CD workflows defined in YAML files.

### Q13. Why use GitHub Secrets?

Secrets store sensitive values such as Docker Hub tokens, server IPs, and SSH private keys without committing them into the repository.

### Q14. Why tag Docker images with Git SHA?

The Git SHA identifies the exact source code used to build the image, making deployment and rollback traceable.

### Q15. Why should CI run before deployment?

CI catches problems before deployment. If tests or build fail, the pipeline should stop.

### Q16. What is a multi-stage Docker build?

A multi-stage build uses more than one `FROM` instruction. One stage can install dependencies and build the app, while the final stage contains only the files needed to run the app.

Example:

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
CMD ["node", "dist/main.js"]
```

Why it is useful:

- smaller production image
- no TypeScript source needed in runtime image
- no dev dependencies in runtime image
- cleaner separation between build and run

### Q17. Why use `npm ci` in CI/CD instead of `npm install`?

`npm ci` installs dependencies exactly from `package-lock.json`. It is more predictable for CI because it avoids silently changing dependency versions.

Short answer:

```text
npm install = useful during development
npm ci      = better for repeatable CI builds
```

### Q18. What is Docker build context?

The build context is the set of files sent to Docker when running:

```bash
docker build -t my-api .
```

The `.` means the current folder is the context. Docker can only `COPY` files from inside that context.

This is why `.dockerignore` matters. Without it, Docker may send unnecessary files such as:

```text
node_modules
dist
.git
logs
coverage
local env files
```

### Q19. Why should `node_modules` usually be inside `.dockerignore`?

Because dependencies should be installed inside the image using the image operating system.

If you copy local `node_modules` from your laptop:

```text
macOS node_modules -> Linux container
```

native packages may break because they were compiled for a different environment.

### Q20. What is the difference between `ARG` and `ENV` in Docker?

`ARG` is available during image build.

`ENV` is available inside the running container.

Example:

```dockerfile
ARG NODE_ENV=production
ENV NODE_ENV=$NODE_ENV
```

Interview answer:

```text
ARG configures the build.
ENV configures the runtime container.
```

Important: neither `ARG` nor `ENV` should be used for secrets inside the Dockerfile.

### Q21. Where should production secrets be stored?

Production secrets should be stored in the deployment platform or CI/CD secret store, not in Git and not in the Docker image.

Examples:

```text
GitHub Actions Secrets
AWS Secrets Manager
GCP Secret Manager
Kubernetes Secrets
Docker Swarm secrets
server environment variables
```

Bad:

```dockerfile
ENV DATABASE_PASSWORD=my-password
```

Good:

```text
inject DATABASE_PASSWORD at runtime
```

### Q22. Does `depends_on` mean the database is ready?

No. In Docker Compose, `depends_on` controls startup order. It does not always guarantee the database is ready to accept connections.

Example problem:

```text
postgres container started
API container started
API immediately connects
Postgres is still initializing
connection fails
```

Better handling:

```text
add retry logic in the app
use healthcheck
make migrations wait for DB readiness
```

### Q23. What is a Docker health check?

A health check tells Docker how to verify whether a container is healthy.

Example:

```dockerfile
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1
```

In backend projects, a health endpoint usually checks:

```text
app is running
database connection is available
critical dependencies are reachable
```

### Q24. What is the difference between a bind mount and a named volume?

Bind mount:

```text
host folder -> container folder
```

Good for development because code changes on the host appear inside the container.

Named volume:

```text
Docker-managed storage -> container folder
```

Good for persistent service data such as PostgreSQL, Redis, or RabbitMQ.

### Q25. What happens to container data when the container is removed?

Data written inside the container filesystem is removed with the container.

Data stored in a named volume survives.

Example:

```text
container filesystem data = temporary
volume data               = persistent
```

### Q26. Why should a backend container write logs to stdout/stderr?

Containers should usually write logs to stdout/stderr so Docker, CI, or the deployment platform can collect logs.

Good:

```text
console.log(...)
logger.info(...)
```

Avoid depending only on local files inside the container because files may disappear when the container is replaced.

### Q27. What is a restart policy?

A restart policy tells Docker whether to restart a container when it exits.

Example:

```yaml
restart: unless-stopped
```

Common options:

```text
no              do not restart automatically
always          always restart
unless-stopped  restart unless manually stopped
on-failure      restart only if exit code is non-zero
```

### Q28. Why is using `latest` risky in production?

`latest` is mutable. The same tag can point to different images over time.

Problem:

```text
server runs my-api:latest
new latest is pushed
rollback or debugging becomes unclear
```

Better:

```text
my-api:git-sha
my-api:release-2026-06-23
```

### Q29. How do you roll back a Docker deployment?

A simple rollback means running the previous known-good image tag.

Example:

```bash
docker pull my-user/my-api:previous-sha
docker stop my-api
docker rm my-api
docker run --name my-api -d -p 3000:3000 my-user/my-api:previous-sha
```

In real production, rollback should also consider:

```text
database migrations
environment variables
backward compatibility
message queue compatibility
cached data
```

### Q30. What is the weakness of simple SSH deployment?

Simple SSH deployment often does this:

```text
stop old container
remove old container
start new container
```

Weakness:

```text
there is downtime between stop and start
if the new container fails, production may be down
rollback is manual
```

Better approaches:

```text
run new container first
health check new container
switch traffic after health check passes
keep previous image available for rollback
```

### Q31. What is blue-green deployment?

Blue-green deployment runs two versions:

```text
blue  = current production
green = new version
```

The system deploys and verifies green first. If green is healthy, traffic switches from blue to green.

Benefit:

```text
less downtime
fast rollback by switching traffic back
safer release process
```

### Q32. Why should Docker images be built in CI instead of manually on the server?

Building in CI makes the artifact traceable and repeatable.

Good flow:

```text
Git commit
CI runs tests
CI builds Docker image
CI tags image with Git SHA
CI pushes image
server pulls exact image tag
```

Bad flow:

```text
SSH into server
git pull
docker build manually
```

The bad flow makes it harder to prove which code is running in production.

### Q33. Why should deployment use the same image that CI tested?

If CI tests one artifact but production runs another artifact, the test result is weaker.

Good:

```text
test -> build image -> push same image -> deploy same image
```

The goal is artifact consistency:

```text
the thing that passed CI is the thing that gets deployed
```

### Q34. What should happen if CI tests fail?

The pipeline should stop and deployment should not run.

Example rule:

```text
test failed -> build skipped or marked failed
build failed -> push skipped
push failed -> deploy skipped
```

### Q35. What is the difference between Continuous Delivery and Continuous Deployment?

Continuous Delivery:

```text
code is automatically tested and prepared for release
human approval may still be required for production
```

Continuous Deployment:

```text
code is automatically deployed to production after passing checks
```

### Q36. Why is a lockfile important in Docker and CI?

The lockfile records exact dependency versions.

For Node.js:

```text
package-lock.json
```

Without a lockfile, two builds from the same source code may install different dependency versions.

### Q37. What files should usually not be committed to Git?

Usually avoid committing:

```text
.env
node_modules
dist
coverage
logs
local database files
private keys
```

But commit:

```text
Dockerfile
compose.yml
.dockerignore
package-lock.json
.github/workflows/*.yml
```

### Q38. What is the difference between local Compose and production deployment?

Local Compose is mainly for development:

```text
API + database + Redis + RabbitMQ on developer machine
easy startup
easy logs
bind mounts for fast changes
```

Production deployment needs stronger handling:

```text
secrets
health checks
scaling
monitoring
backups
rollback
zero-downtime deploy
```

### Q39. What does it mean when a container exits with code 1?

Exit code `1` usually means the process inside the container failed.

Check:

```bash
docker logs container-name
docker inspect container-name
```

Common causes:

```text
missing environment variable
wrong start command
database connection failed during startup
missing build output
dependency error
```

### Q40. What should a good backend CI pipeline check?

At minimum:

```text
install dependencies
lint
unit tests
integration tests if available
build
Docker image build
```

For stronger projects:

```text
security scan
dependency audit
migration check
type check
e2e tests
push image only from protected branch
deploy only after successful checks
```

---

## 26. Scenario Questions

### Scenario 1: API cannot connect to PostgreSQL in Compose

Symptom:

```text
ECONNREFUSED 127.0.0.1:5432
```

Likely cause:

```text
The API container is trying to connect to PostgreSQL using localhost.
```

Fix:

```text
Use postgres service name:
postgres://app:password@postgres:5432/app
```

### Scenario 2: Data disappears after restarting database container

Likely cause:

```text
No persistent volume is configured.
```

Fix:

```yaml
volumes:
  - postgres_data:/var/lib/postgresql/data
```

### Scenario 3: CI passes but server still runs old code

Possible causes:

- new image was not pushed
- server pulled wrong tag
- container was not recreated
- using mutable `latest` tag caused confusion

Fix:

```text
Use immutable image tags such as Git SHA.
Log the deployed image tag.
Make deploy script pull and run the exact tag.
```

### Scenario 4: Deployment succeeds, but container exits immediately

Check:

```text
docker logs container-name
environment variables
startup command
port binding
database connectivity
missing build output
```

### Scenario 5: GitHub Actions cannot push to Docker Hub

Check:

```text
DOCKERHUB_USERNAME secret exists
DOCKERHUB_TOKEN secret exists
token has push permission
image name is correct
docker/login-action ran before push
```

### Scenario 6: API container cannot connect to Redis

Symptom:

```text
ECONNREFUSED 127.0.0.1:6379
```

Likely cause:

```text
The API container uses localhost instead of the Redis Compose service name.
```

Fix:

```text
Use redis:6379 from inside the Compose network.
Use localhost:6379 only from the host machine.
```

### Scenario 7: API starts before database is ready

Symptom:

```text
API fails on startup even though postgres container is running.
```

Likely cause:

```text
depends_on started postgres before api, but postgres was not ready yet.
```

Fix:

```text
add retry logic in database connection
add healthcheck to postgres
run migrations only after DB is ready
```

### Scenario 8: Docker image is very large

Possible causes:

```text
node_modules copied from host
dev dependencies included
.git copied into image
coverage and logs copied
single-stage build keeps build tools
```

Fix:

```text
add .dockerignore
use npm ci --omit=dev in runtime image
use multi-stage build
use smaller base image when suitable
```

### Scenario 9: GitHub Actions is slow

Possible causes:

```text
dependencies installed from scratch every run
Docker layers not cached
too many jobs doing the same work
large build context
tests are not separated by type
```

Fix:

```text
use setup-node cache
improve Docker layer order
copy package files before source files
add .dockerignore
split fast checks and slow checks when needed
```

### Scenario 10: Deployment works, but environment variables are missing

Symptom:

```text
app starts locally but fails on production server
```

Likely cause:

```text
production docker run command did not pass required env vars
or CI/CD secrets were not configured
```

Fix:

```text
document required environment variables
validate env vars on app startup
inject secrets at runtime
do not bake secrets into the image
```

### Scenario 11: New deployment breaks because database migration is incompatible

Problem:

```text
new code expects a new column
old database does not have it yet
or migration removes a column still used by old code
```

Safer approach:

```text
make migrations backward compatible
deploy additive schema changes first
deploy code after schema is ready
remove old columns in a later release
```

### Scenario 12: Server disk becomes full after many deployments

Symptoms:

```text
docker pull fails
container cannot write logs
database may become unhealthy
```

Check:

```bash
docker system df
docker image ls
docker ps -a
```

Fix carefully:

```text
remove unused images and stopped containers
rotate logs
monitor disk usage
do not delete database volumes unless you intentionally want to remove data
```

### Scenario 13: Health check passes, but real users still get errors

Likely cause:

```text
health endpoint only checks that the process is running
but does not check critical dependencies
```

Improve health checks:

```text
basic liveness check: process is alive
readiness check: app can serve traffic
dependency check: DB/cache/queue are reachable when required
```

### Scenario 14: Docker build works locally but fails in CI

Possible causes:

```text
file exists locally but is not committed
case-sensitive path issue
missing package-lock.json
wrong Node.js version
environment variable available locally but missing in CI
```

Fix:

```text
commit required files
pin Node.js version
use npm ci
avoid depending on local-only files
make CI run the same build command as production
```

---

## 27. Assignments

### Assignment 1: Run Your First Container

Run an existing image:

```bash
docker run --name hello-nginx -p 8080:80 -d nginx:alpine
curl http://localhost:8080
docker logs hello-nginx
docker exec -it hello-nginx /bin/sh
docker stop hello-nginx
docker rm hello-nginx
```

Explain:

- what image was used
- what container was created
- what `-p 8080:80` means
- why `docker exec` works only when container is running

### Assignment 2: Dockerize a Node/NestJS API

Create:

```text
Dockerfile
.dockerignore
```

Requirements:

```text
build image
run container
map port 3000
call health endpoint
view logs
enter container shell
```

Commands:

```bash
docker build -t my-api:local .
docker run --name my-api -p 3000:3000 -d my-api:local
curl http://localhost:3000/health
```

### Assignment 3: Add PostgreSQL With Compose

Create `compose.yml` with:

```text
api service
postgres service
named postgres volume
DATABASE_URL using postgres service name
```

Verify:

```text
API can connect to DB
data survives container recreation
```

### Assignment 4: Add Redis and RabbitMQ

Extend Compose with:

```text
redis service
rabbitmq service
environment variables
ports
volumes for RabbitMQ
```

Verify:

```text
API connects to Redis using redis:6379
API connects to RabbitMQ using rabbitmq:5672
RabbitMQ management UI opens at localhost:15672
```

### Assignment 5: Build a GitHub Actions CI Pipeline

Create `.github/workflows/ci.yml`.

Required steps:

```text
checkout
setup Node.js
npm ci
lint
test
build
docker build
```

Acceptance criteria:

```text
pipeline fails when tests fail
pipeline fails when build fails
pipeline succeeds when project is valid
```

### Assignment 6: Push Image to Docker Hub

Add GitHub secrets:

```text
DOCKERHUB_USERNAME
DOCKERHUB_TOKEN
```

Pipeline should:

```text
login to Docker Hub
build image
tag image with Git SHA
push image
```

Verify:

```text
image appears in Docker Hub
tag matches commit SHA
```

### Assignment 7: SSH Deploy to a Server

Prepare server:

```text
install Docker
open required port
add SSH key access
```

Add GitHub secrets:

```text
SERVER_HOST
SERVER_USER
SSH_PRIVATE_KEY
```

Pipeline should:

```text
SSH into server
docker pull image
stop old container
remove old container
run new container
```

Explain the weakness of this deployment style and how rolling/blue-green deployment improves it.

### Assignment 8: Practice Docker Interview Debugging

Prepare answers for these questions:

```text
1. API cannot connect to postgres in Compose. What do you check first?
2. Container exits immediately after deployment. What commands do you run?
3. Docker image is 1.5GB. How do you reduce it?
4. CI passes but production has old code. What could be wrong?
5. Why should secrets not be inside Dockerfile?
6. How do you roll back to the previous image?
7. Why is latest dangerous in production?
8. What is the difference between liveness and readiness checks?
9. What happens if database migration fails during deployment?
10. Why should production logs go to stdout/stderr?
```

For each answer, include:

```text
root cause
command to inspect
fix
prevention for next time
```

### Assignment 9: Design a Real Backend CI/CD Flow

Design a pipeline for this backend stack:

```text
NestJS API
PostgreSQL
Redis
RabbitMQ
Docker Hub
one Linux production server
GitHub Actions
```

Your answer should include:

```text
local Docker Compose services
Dockerfile strategy
CI steps for pull requests
CI/CD steps after merge to main
image tagging strategy
secrets needed
deployment command
rollback strategy
health check strategy
```

Acceptance criteria:

```text
developer can run the stack locally
pull request cannot merge if tests fail
production deploy uses exact image tag
rollback does not require rebuilding image
secrets are not committed to Git
```

---

## 28. Final Summary

Docker:

```text
packages app + runtime + dependencies into an image
```

Container:

```text
running instance of an image
```

Docker Compose:

```text
runs multi-container local stacks from one YAML file
```

CI:

```text
automatically checks code quality, tests, and build
```

CD:

```text
automatically prepares or deploys release artifacts
```

Real backend flow:

```text
Dockerfile builds API image
Compose runs API + DB + Redis + RabbitMQ locally
GitHub Actions tests code
Pipeline builds and pushes image
Server or platform pulls and deploys exact image tag
```

Short interview answer:

> Docker makes the runtime reproducible. Docker Compose makes local multi-service development easier. CI/CD automates testing, building, pushing, and deploying the Docker image so releases are repeatable and less manual.
