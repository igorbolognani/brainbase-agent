# GPTRouter

**Intelligent model routing for lowest-cost adequate capability**

GPTRouter is a unified OpenAI Apps SDK application that routes AI tasks to the most cost-effective model or provider capable of completing them successfully. It combines intelligent routing algorithms, budget enforcement, provider connection management, and optional integration with external model gateways.

## Product Vision

GPTRouter is **one unified application** built with OpenAI Apps SDK + MCP, providing a single UI inside ChatGPT. It is not multiple separate products.

### Core Principle

**Lowest-cost adequate capability**: Start with the most cost-effective model that can handle the task. Escalate only when evidence warrants it.

### Product Architecture

**Primary Routing Path**: GPTRouter connects directly to provider APIs (OpenAI, Anthropic, Google, etc.)

**Optional Gateway Integration**: Users can optionally connect external model gateways/proxies (9 Router, OpenRouter, or other OpenAI-compatible services) for additional routing layers. Gateways are a connection type within the same app, not separate products.

### Key Pages/Features

1. **Overview**: Dashboard with usage metrics, recent tasks, budget status
2. **Router**: Configure routing policies, view routing decisions, manage escalation rules
3. **Tasks**: Task history, execution logs, cost analysis per task
4. **Engineering**: GPTRouter's own control plane UI for managing repositories, execution environments, and task orchestration (executor-agnostic; may use OpenCode, Codex, or other harnesses)
5. **Models**: Browse available models, capabilities, current pricing metadata
6. **Providers & Connections**: Manage provider account connections, OAuth flows, connection status
7. **Model Gateways / Proxies**: Configure optional external gateway integrations
8. **Usage & Budgets**: Budget enforcement, spending caps, usage analytics
9. **Security & Permissions**: Credential management, access controls, tenant isolation
10. **Activity / Audit**: Comprehensive audit logs, routing provenance, execution history
11. **Settings**: Application preferences, notification settings

## Architecture

### Security-First Design

- **Credential Isolation**: Provider API keys/tokens are NEVER exposed in model-visible contexts, MCP responses, ChatGPT messages, or logs
- **Secure Credential Capture**: OAuth/OIDC flows or encrypted server-side storage only
- **Opaque References**: MCP surfaces connection IDs and status; never raw credentials or vault paths
- **SSRF Protection**: User-configurable gateway URLs require HTTPS, DNS/IP validation, and blocking of private/link-local/cloud-metadata addresses
- **Tenant Isolation**: Strict per-user account boundaries; users connect their own provider accounts

### Routing Algorithm

**Two-Stage Process**:

1. **Admissibility Filter**: Identify routes that satisfy:
   - Task capability requirements
   - Model availability
   - Policy constraints
   - Budget and security limits

2. **Ordering**: Rank admissible routes by configured policy:
   - Cost optimization (default)
   - Quality/capability
   - Latency
   - Custom user preferences

**Manual Override**: Requires validation against admissibility criteria

### Domain Model

Core concepts:

- **ProviderConnection**: Direct connection to a model provider API
- **GatewayConnection**: Connection to an external model gateway/proxy
- **ModelRoute**: A route to a specific model via a connection; includes route_type, identifiers, pricing metadata version
- **RoutingPolicy**: Rules for admissibility and ordering
- **Task**: A unit of work to be executed (planning vs execution phases)
- **RoutingDecision**: Immutable snapshot of route selection with full provenance
- **ExecutionAttempt**: Record of task execution with idempotency, cancellation semantics
- **UsageRecord**: Reconciled actual cost from provider evidence
- **AuditEvent**: Security and compliance audit trail

### Execution Model

- **Planning (`route_task`)**: MUST NOT spend money; returns routing decision with estimated cost
- **Execution (`run_task`)**: Consequential action with server-side budget enforcement
- **Idempotency**: Explicit idempotency keys for all consequential operations
- **Cancellation**: Best-effort; `cancel_requested` ≠ `cancelled`; completion may race
- **Provenance**: Full snapshot of route, pricing metadata version, policy version

### Data Integrity

- **No Hardcoded Model Data**: Domain code contains no hardcoded production model names or prices
- **Dynamic Metadata**: Model catalog includes provenance, effective_at, refreshed_at, version
- **Version-Aware Pricing**: Estimates tagged with metadata version; not canonical truth
- **Actual Cost Reconciliation**: Real costs from provider evidence, not estimates

## Technology Stack

- **TypeScript**: Modern ESM modules
- **OpenAI Apps SDK**: Native ChatGPT integration
- **MCP (Model Context Protocol)**: Server-side protocol implementation
- **Monorepo Structure**: Clean package boundaries for contracts, domain, security, providers

## Getting Started

```bash
# Install dependencies
npm install

# Run type checking
npm run typecheck

# Run tests
npm test

# Run linter
npm run lint

# Build all packages
npm run build
```

## Development

See documentation in `docs/`:

- `product.md`: Detailed product vision and requirements
- `architecture.md`: System architecture and design patterns
- `domain-model.md`: Core domain concepts and relationships
- `data-model.md`: Entity schemas and relationships
- `contracts.md`: API and MCP contract definitions
- `security.md`: Security architecture and threat model
- `technical-design.md`: Implementation details and patterns
- `adr/`: Architectural decision records

## Contributing

This repository follows strict implementation guidelines. See `AGENTS.md` for detailed guidance on:

- Architecture constraints and security boundaries
- Routing and execution semantics
- Testing requirements
- Development workflow

## License

[License TBD]
