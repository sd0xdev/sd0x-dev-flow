# sd0x-dev-flow

**Idioma**: [English](README.md) | [繁體中文](README.zh-TW.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | Español

Plugin de workflow de desarrollo para [Claude Code](https://claude.com/claude-code) con integración opcional de Codex MCP.

Más de 90 herramientas para code review, testing, investigación, auditoría de seguridad y automatización DevOps.

## Mínimo consumo de Context

Este plugin ocupa solo **~4% de la ventana de 200k tokens de Context** de Claude, proporcionando más de 90 herramientas — una ventaja arquitectónica clave.

| Componente | Tokens | % de 200k |
|------------|--------|-----------|
| Rules (carga permanente) | 5.1k | 2.6% |
| Skills (bajo demanda) | 1.9k | 1.0% |
| Agents | 791 | 0.4% |
| **Total** | **~8k** | **~4%** |

Por qué es importante:

| Ventaja | Descripción |
|---------|-------------|
| Más espacio para tu código | El 96% del Context queda disponible para archivos, diffs y conversación |
| Sin degradación de rendimiento | La sobrecarga del plugin es mínima — Claude responde igual de rápido |
| Skills se cargan bajo demanda | Solo se carga el Skill que ejecutas; los inactivos no consumen tokens |
| Escala con la complejidad | Puedes usar múltiples herramientas en una sesión sin alcanzar el límite |

## Requisitos

- Claude Code 2.1+
- [Codex MCP](https://github.com/openai/codex) configurado (para comandos `/codex-*`)

## Instalación

```bash
# Agregar marketplace
/plugin marketplace add sd0xdev/sd0x-dev-flow

# Instalar plugin
/plugin install sd0x-dev-flow@sd0xdev-marketplace
```

## Inicio rápido

Tras instalar, ejecuta `/project-setup` para autodetectar el entorno del proyecto y configurar los placeholders:

```bash
/project-setup
```

Detecta framework, package manager, base de datos, entry points y scripts, y actualiza `CLAUDE.md` automáticamente.

## Contenido

| Categoría | Cantidad | Ejemplos |
|-----------|----------|----------|
| Commands | 47 | `/project-setup`, `/codex-review-fast`, `/verify`, `/next-step` |
| Skills | 31 | project-setup, code-explore, next-step, skill-health-check |
| Agents | 14 | strict-reviewer, verify-app, coverage-analyst |
| Hooks | 5 | pre-edit-guard, auto-format, review state tracking, stop guard, namespace hint |
| Rules | 10 | auto-loop, codex-invocation, security, testing, git-workflow |
| Scripts | 4 | precommit runner, verify runner, dep audit, namespace hint |

## Workflow

### Auto-Loop: Edit → Review → Gate

El motor de ejecución central. Tras cualquier edición de código, Claude **automáticamente** dispara la revisión en la misma respuesta — sin pasos manuales. Los Hooks bloquean la detención hasta que todas las puertas pasen.

```mermaid
sequenceDiagram
    participant D as Desarrollador
    participant C as Claude
    participant X as Codex MCP
    participant H as Hooks

    D->>C: Editar código
    H->>H: Rastrear cambio de archivo
    C->>X: /codex-review-fast (auto)
    X-->>C: P0/P1 hallazgos

    alt Issues encontrados
        C->>C: Corregir todos los issues
        C->>X: --continue threadId
        X-->>C: Re-verificar
    end

    X-->>C: ✅ Ready
    C->>C: /precommit (auto)
    C-->>D: ✅ Todas las puertas pasaron

    Note over H: stop-guard bloquea hasta que<br/>review + precommit pasen
```

### Cadena de Planificación

El brainstorming adversarial alcanza el Equilibrio de Nash mediante investigación independiente de Claude + Codex y debate en múltiples rondas, luego fluye hacia la planificación estructurada.

```mermaid
flowchart LR
    A["/codex-brainstorm<br/>Equilibrio de Nash"] --> B["/feasibility-study"]
    B --> C["/tech-spec"]
    C --> D["/codex-architect"]
    D --> E["Listo para implementar"]
```

### Tracks por tipo de trabajo

```mermaid
flowchart TD
    subgraph feat ["Desarrollo de funcionalidad"]
        F1["/feature-dev"] --> F2["Código + Tests"]
        F2 --> F3["/verify"]
        F3 --> F4["/codex-review-fast"]
        F4 --> F5["/precommit"]
        F5 --> F6["/update-docs"]
    end

    subgraph fix ["Corrección de bugs"]
        B1["/issue-analyze"] --> B2["/bug-fix"]
        B2 --> B3["Fix + Test de regresión"]
        B3 --> B4["/verify"]
        B4 --> B5["/codex-review-fast"]
        B5 --> B6["/precommit"]
    end

    subgraph docs ["Solo documentación"]
        D1["Editar .md"] --> D2["/codex-review-doc"]
        D2 --> D3["Listo"]
    end
```

### Gobernanza operativa

```mermaid
flowchart TD
    S["/project-setup"] --> R["/repo-intake"]
    R --> DEV["Desarrollar"]
    DEV --> A["/project-audit<br/>Puntuación de salud"]
    DEV --> RA["/risk-assess<br/>Cambios destructivos"]
    A --> N["/next-step"]
    RA --> N
    N --> |"--go"|AUTO["Auto-despacho"]
```

### Vista general

```mermaid
flowchart LR
    P["Planificar"] --> B["Construir"]
    B --> G["Puerta"]
    G --> S["Entregar"]

    P -.- P1["/codex-brainstorm<br/>/feasibility-study<br/>/tech-spec"]
    B -.- B1["/feature-dev<br/>/bug-fix<br/>/codex-implement"]
    G -.- G1["/codex-review-fast<br/>/precommit<br/>/codex-test-review"]
    S -.- S1["/pr-review<br/>/update-docs"]
```

### Catálogo de workflows

| Workflow | Disparador | Comandos principales | Gate | Capa de ejecución |
|----------|-----------|---------------------|------|-------------------|
| Desarrollo de funcionalidad | Manual | `/feature-dev` → `/verify` → `/codex-review-fast` → `/precommit` | ✅/⛔ | Hook + Comportamiento |
| Corrección de bugs | Manual | `/issue-analyze` → `/bug-fix` → `/verify` → `/codex-review-fast` → `/precommit` | ✅/⛔ | Hook + Comportamiento |
| Auto-Loop Review | Edición de código | `/codex-review-fast` → `/precommit` | ✅/⛔ | Hook |
| Revisión de docs | Edición `.md` | `/codex-review-doc` | ✅/⛔ | Hook |
| Sincronización de docs | Precommit aprobado | `/update-docs` → `/create-request --update` | ✅/⚠️ | Comportamiento |
| Planificación | Manual | `/codex-brainstorm` → `/feasibility-study` → `/tech-spec` | — | — |
| Evaluación de riesgos | Manual | `/project-audit` → `/risk-assess` | ✅/⛔ | — |
| Onboarding | Primer uso | `/project-setup` → `/repo-intake` → `/install-rules` | — | — |

## Referencia de comandos

### Desarrollo

| Comando | Descripción |
|---------|-------------|
| `/project-setup` | Autodetección y configuración del proyecto |
| `/repo-intake` | Escaneo inicial del proyecto (una sola vez) |
| `/install-rules` | Instalar reglas del plugin en `.claude/rules/` |
| `/install-hooks` | Instalar hooks del plugin en `.claude/` |
| `/bug-fix` | Workflow de corrección de bugs |
| `/codex-implement` | Codex escribe código |
| `/codex-architect` | Consultoría de arquitectura (tercer cerebro) |
| `/code-explore` | Exploración rápida del codebase |
| `/git-investigate` | Rastreo del historial de código |
| `/issue-analyze` | Análisis profundo de issues |
| `/post-dev-test` | Tests complementarios post-desarrollo |
| `/feature-dev` | Workflow de desarrollo (diseño → implementación → verificación → review) |
| `/feature-verify` | Diagnóstico de sistema (verificación de solo lectura, doble perspectiva) |
| `/code-investigate` | Investigación de código con doble perspectiva (Claude + Codex independientes) |
| `/next-step` | Asesor contextual de siguiente paso |

### Review (Codex MCP)

| Comando | Descripción | Loop support |
|---------|-------------|--------------|
| `/codex-review-fast` | Review rápido (solo diff) | `--continue <threadId>` |
| `/codex-review` | Review completo (lint + build) | `--continue <threadId>` |
| `/codex-review-branch` | Review de branch completo | - |
| `/codex-cli-review` | Review CLI (lectura completa de disco) | - |
| `/codex-review-doc` | Review de documentación | `--continue <threadId>` |
| `/codex-security` | Auditoría OWASP Top 10 | `--continue <threadId>` |
| `/codex-test-gen` | Generar tests unitarios | - |
| `/codex-test-review` | Review de test coverage | `--continue <threadId>` |
| `/codex-explain` | Explicar código complejo | - |

### Verificación

| Comando | Descripción |
|---------|-------------|
| `/verify` | lint -> typecheck -> unit -> integration -> e2e |
| `/precommit` | lint:fix -> build -> test:unit |
| `/precommit-fast` | lint:fix -> test:unit |
| `/dep-audit` | Auditoría de seguridad de dependencias |
| `/project-audit` | Auditoría de salud del proyecto (puntuación determinista) |
| `/risk-assess` | Evaluación de riesgos de código no commiteado |

### Planificación

| Comando | Descripción |
|---------|-------------|
| `/codex-brainstorm` | Brainstorming adversarial (equilibrio de Nash) |
| `/feasibility-study` | Análisis de viabilidad |
| `/tech-spec` | Generar tech spec |
| `/review-spec` | Revisar tech spec |
| `/deep-analyze` | Análisis profundo + roadmap |
| `/project-brief` | Resumen ejecutivo para PM/CTO |

### Documentación y herramientas

| Comando | Descripción |
|---------|-------------|
| `/update-docs` | Sincronizar docs con código |
| `/check-coverage` | Análisis de test coverage |
| `/create-request` | Crear/actualizar docs de requisitos |
| `/doc-refactor` | Simplificar documentación |
| `/simplify` | Simplificar código |
| `/de-ai-flavor` | Eliminar artefactos de IA |
| `/create-skill` | Crear nuevos skills |
| `/pr-review` | Self-review de PR |
| `/skill-health-check` | Validar calidad y routing de skills |
| `/claude-health` | Verificación de configuración de Claude Code |
| `/zh-tw` | Reescribir en chino tradicional |

## Rules

| Rule | Descripción |
|------|-------------|
| `auto-loop` | Fix -> re-review -> fix -> ... -> Pass (ciclo automático) |
| `codex-invocation` | Codex debe investigar independientemente, nunca alimentar conclusiones |
| `fix-all-issues` | Tolerancia cero: corregir todos los issues encontrados |
| `framework` | Convenciones del framework (personalizables) |
| `testing` | Aislamiento Unit/Integration/E2E |
| `security` | Checklist OWASP Top 10 |
| `git-workflow` | Naming de branches, convenciones de commits |
| `docs-writing` | Tablas > párrafos, Mermaid > texto |
| `docs-numbering` | Prefijos de documentos (0-feasibility, 2-spec) |
| `logging` | JSON estructurado, sin secrets |

## Hooks

| Hook | Trigger | Propósito |
|------|---------|-----------|
| `namespace-hint` | SessionStart | Inyectar guía de namespace de comandos del plugin en el contexto de Claude |
| `post-edit-format` | Después de Edit/Write | Auto prettier + invalidar estado de review al editar |
| `post-tool-review-state` | Después de Bash / herramientas MCP | Tracking de estado de review (sentinel routing, soporte de comandos con namespace) |
| `pre-edit-guard` | Antes de Edit/Write | Prevenir edición de .env/.git |
| `stop-guard` | Antes de detener | Advertir si hay reviews incompletos + verificación stale-state git (default: warn) |

### Configuración de hooks

Los hooks son seguros por defecto. Variables de entorno para personalizar:

| Variable | Default | Descripción |
|----------|---------|-------------|
| `STOP_GUARD_MODE` | `warn` | Usar `strict` para bloquear stop si faltan pasos de review |
| `HOOK_NO_FORMAT` | (no definido) | `1` para desactivar auto-formateo |
| `HOOK_BYPASS` | (no definido) | `1` para saltar todos los checks de stop-guard |
| `HOOK_DEBUG` | (no definido) | `1` para mostrar info de debug |
| `GUARD_EXTRA_PATTERNS` | (no definido) | Regex para paths protegidos adicionales (ej. `src/locales/.*\.json$`) |

**Dependencias**: Los hooks requieren `jq`. El auto-formateo requiere `prettier` en el proyecto. Si faltan dependencias, los hooks se omiten automáticamente.

## Personalización

Ejecuta `/project-setup` para autodetectar y configurar todos los placeholders, o edita `CLAUDE.md` manualmente:

| Placeholder | Descripción | Ejemplo |
|-------------|-------------|---------|
| `{PROJECT_NAME}` | Nombre del proyecto | my-app |
| `{FRAMEWORK}` | Framework | MidwayJS 3.x, NestJS, Express |
| `{CONFIG_FILE}` | Archivo de config principal | src/configuration.ts |
| `{BOOTSTRAP_FILE}` | Entry de bootstrap | bootstrap.js, main.ts |
| `{DATABASE}` | Base de datos | MongoDB, PostgreSQL |
| `{TEST_COMMAND}` | Comando de tests | yarn test:unit |
| `{LINT_FIX_COMMAND}` | Auto-fix de lint | yarn lint:fix |
| `{BUILD_COMMAND}` | Comando de build | yarn build |
| `{TYPECHECK_COMMAND}` | Type checking | yarn typecheck |

## Arquitectura

```
Command (entrada) -> Skill (capacidad) -> Agent (entorno)
```

- **Commands**: El usuario los ejecuta con `/...`
- **Skills**: Knowledge bases cargadas bajo demanda
- **Agents**: Subagentes aislados con herramientas específicas
- **Hooks**: Guardrails automatizados (formateo, estado de review, stop guard)
- **Rules**: Convenciones siempre activas (carga automática)
- **Scripts**: Aceleradores opcionales para comandos de verificación (ver abajo)

### Fallback de scripts

Los comandos de verificación (`/precommit`, `/verify`, `/dep-audit`) usan un patrón **Try → Fallback**:

1. **Try**: Si existe un script de ejecución en la raíz del proyecto (`scripts/precommit-runner.js`, etc.), se ejecuta para obtener resultados rápidos y reproducibles.
2. **Fallback**: Si no se encuentra el script, Claude detecta el ecosistema del proyecto (Node.js, Python, Rust, Go, Java) y ejecuta los comandos correspondientes directamente.

El fallback funciona sin ninguna configuración previa. Los scripts de ejecución están incluidos en este plugin, pero debido a una [limitación conocida de Claude Code](https://github.com/anthropics/claude-code/issues/9354) (`${CLAUDE_PLUGIN_ROOT}` no está disponible en el markdown de comandos), actualmente no se pueden resolver automáticamente las rutas de scripts desde comandos del plugin. Se actualizará cuando se resuelva el problema en upstream.

## Contribuir

PRs bienvenidos. Por favor:

1. Seguir las convenciones de naming existentes (kebab-case)
2. Incluir `When to Use` / `When NOT to Use` en skills
3. Agregar `disable-model-invocation: true` para operaciones peligrosas
4. Testear con Claude Code antes de enviar

## Licencia

MIT
