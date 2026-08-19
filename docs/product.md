# Product Vision

## Overview

GPTRouter is a unified OpenAI Apps SDK application that intelligently routes AI tasks to the most cost-effective model or provider capable of completing them successfully.

## Core Principle

**Lowest-cost adequate capability**: Always start with the most cost-effective model that meets the task requirements. Escalate to more capable (and expensive) models only when evidence warrants it.

## Product Identity

- **One unified GPTRouter App** built with OpenAI Apps SDK + MCP
- **Single UI inside ChatGPT**, not multiple separate products
- **Executor-agnostic design**: Engineering control plane can work with OpenCode, Codex, or other execution harnesses without changing the UI

## Routing Paths

### Primary Path: Direct Provider Integration
- GPTRouter connects directly to provider APIs
- Providers: OpenAI, Anthropic, Google, Cohere, Mistral, etc.
- Users connect their own provider accounts/credentials
- Strict tenant isolation

### Optional Path: External Gateways
- Users can optionally connect external model gateways/proxies
- Examples: 9 Router, OpenRouter, or other OpenAI-compatible services
- Gateways are just a page/connection type inside the same app
- Not a separate product architecture

## Application Pages

### 1. Overview
- Dashboard with key metrics
- Recent tasks and routing decisions
- Budget status and spending trends
- Quick actions

### 2. Router
- Configure routing policies
- View routing decisions and explanations
- Manage escalation rules
- Cost optimization settings

### 3. Tasks
- Task history and execution logs
- Cost analysis per task
- Success/failure metrics
- Retry and cancellation management

### 4. Engineering
- GPTRouter's own control plane UI
- Repository management
- Execution environment configuration
- Task orchestration settings
- **Executor-agnostic**: Future abstraction may use OpenCode, Codex, or another harness
- **Not an OpenCode UI**: This is GPTRouter's engineering control surface

### 5. Models
- Browse available models
- Model capabilities and requirements
- Current pricing metadata (with version/provenance)
- Performance characteristics

### 6. Providers & Connections
- Manage provider account connections
- OAuth/OIDC flow initiation
- Connection status monitoring
- Credential lifecycle (never exposed to client)

### 7. Model Gateways / Proxies
- Configure external gateway integrations
- Gateway connection status
- Routing through gateways
- Gateway-specific settings

### 8. Usage & Budgets
- Spending analytics
- Budget enforcement configuration
- Daily/monthly caps
- Cost allocation and reporting

### 9. Security & Permissions
- Access control management
- Audit configuration
- Tenant isolation status
- Security posture dashboard

### 10. Activity / Audit
- Comprehensive audit logs
- Routing provenance trails
- Execution history with full snapshots
- Compliance reporting

### 11. Settings
- Application preferences
- Notification configuration
- Integration settings
- User profile

## User Experience Principles

### Responsive & Mobile-Friendly
- All pages designed for responsive layouts
- Touch-friendly interactions
- Progressive disclosure of complexity

### Evidence-Based Decisions
- Show routing decision rationale
- Display cost comparisons
- Explain escalation triggers
- Provide structured reason codes

### Transparency
- Full visibility into routing logic
- Cost estimates with confidence levels
- Clear distinction between estimated and actual costs
- Provenance for all decisions

### Safety First
- Budget enforcement before execution
- Confirmation for high-cost operations
- Cancellation (best-effort) support
- Idempotency for all consequential actions

## User Journey

### Initial Setup
1. Connect to ChatGPT via OpenAI Apps SDK
2. Configure first provider connection (OAuth/OIDC)
3. Set initial budget limits
4. Configure basic routing policy (default: cost optimization)

### Daily Usage
1. Submit task via ChatGPT interface
2. GPTRouter analyzes requirements and plans route (no cost)
3. Shows estimated cost and routing decision
4. User confirms execution
5. Task executes with budget enforcement
6. Results returned with actual cost and provenance

### Advanced Configuration
1. Add multiple provider connections
2. Optionally add gateway connections
3. Fine-tune routing policies
4. Set up engineering control plane for code execution tasks
5. Configure budget rules per connection/route class
6. Review audit logs and optimize based on evidence

## Non-Functional Requirements

### Performance
- Route planning: < 500ms for typical task
- Decision explanation: real-time
- Audit log queries: < 2s for typical range

### Reliability
- Provider connection health monitoring
- Automatic failover to alternative routes
- Graceful degradation when providers unavailable

### Security
- Zero credential exposure in model-visible contexts
- SSRF protection for user-configured URLs
- Structured logging with allowlist + central redaction
- Tenant isolation enforced at data layer

### Scalability
- Support hundreds of provider connections per user
- Thousands of tasks per day per user
- Model catalog updates without downtime
- Pricing metadata versioning

## Success Metrics

### Cost Optimization
- Average task cost vs. baseline (direct provider usage)
- Percentage of tasks successfully routed to lower-cost adequate models
- Cost savings per user per month

### Reliability
- Task success rate
- Route availability
- Escalation necessity (how often lowest-cost is inadequate)

### User Satisfaction
- Time to configure first working route
- User-reported accuracy of routing decisions
- Budget overrun incidents (target: 0)

## Future Directions

### Potential Enhancements
- Machine learning for capability prediction
- Historical task analysis for policy tuning
- Multi-model orchestration (parallel execution with voting)
- Custom model fine-tuning integration

### Out of Scope (V0.1)
- Multi-tenant organization management
- Resale/white-label capabilities
- Model training/fine-tuning
- Local model execution (requires future local bridge design)
