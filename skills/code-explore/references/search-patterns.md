# Search Patterns Reference

## Project Structure

```
src/
├── controller/     # API entry points
├── service/        # Business logic
├── provider/       # External service integration
│   ├── evm/
│   ├── btc/
│   └── sol/
├── model/          # Data models
├── config/         # Configuration
└── configuration.ts # DI configuration
```

## Common Search Patterns

### Find API Endpoints

```bash
# Find all Controllers
Grep "export class.*Controller"

# Find specific HTTP methods
Grep "@Get|@Post|@Put|@Delete" --type ts

# Find specific route
Grep "'/api/v1/token'" --type ts
```

### Find Service Methods

```bash
# Find Service classes
Grep "export class.*Service"

# Find specific method
Grep "async getBalance"

# Find dependency injection
Grep "@Inject().*Service"
```

### Find Provider Implementations

```bash
# List all providers
Glob "src/provider/**/*.ts"

# Find specific chain implementation
Glob "src/provider/evm/*.ts"

# Find factory
Grep "ProviderFactory|getProvider"
```

### Find Data Models

```bash
# Find all models
Glob "src/model/**/*.ts"

# Find MongoDB collections
Grep "@Entity|@Collection"

# Find specific field
Grep "tokenAddress.*string"
```

### Find Configuration

```bash
# Main config
Read {CONFIG_FILE}

# Environment config
Glob "src/config/*.ts"

# Find specific config item
Grep "redis|mongo|rpc" --glob "*.config.ts"
```

## Tracing Techniques

### Trace Top-Down from API

```
1. Grep route -> find Controller
2. Read Controller -> find Service call
3. Read Service -> find Provider/Model call
4. Read Provider -> find external service call
```

### Trace Bottom-Up from Error

```
1. Grep error message -> find throw point
2. Identify caller -> trace upward
3. Repeat until reaching entry point
```

### Find Related Tests

```bash
# Corresponding unit test
test/unit/service/{ServiceName}.test.ts

# Corresponding integration test
test/integration/controller/{ControllerName}.test.ts
```

## Common Pitfalls

| Pitfall            | Solution                          |
| ------------------ | --------------------------------- |
| Circular dependency| Check lazy getters                |
| Dynamic loading    | Search `require()` / `import()`  |
| Config override    | Check env variables + config layers |
| Cache layer        | Watch for Redis key patterns      |
