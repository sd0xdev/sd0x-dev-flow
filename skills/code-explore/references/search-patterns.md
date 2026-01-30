# 搜尋模式參考

## 專案結構

```
src/
├── controller/     # API 入口
├── service/        # 業務邏輯
├── provider/       # 外部服務對接
│   ├── evm/
│   ├── btc/
│   └── sol/
├── model/          # 資料模型
├── config/         # 配置
└── configuration.ts # DI 配置
```

## 常用搜尋模式

### 找 API 端點

```bash
# 找所有 Controller
Grep "export class.*Controller"

# 找特定 HTTP method
Grep "@Get|@Post|@Put|@Delete" --type ts

# 找特定路由
Grep "'/api/v1/token'" --type ts
```

### 找 Service 方法

```bash
# 找 Service 類別
Grep "export class.*Service"

# 找特定方法
Grep "async getBalance"

# 找依賴注入
Grep "@Inject().*Service"
```

### 找 Provider 實作

```bash
# 列出所有 provider
Glob "src/provider/**/*.ts"

# 找特定鏈的實作
Glob "src/provider/evm/*.ts"

# 找 factory
Grep "ProviderFactory|getProvider"
```

### 找資料模型

```bash
# 找所有 model
Glob "src/model/**/*.ts"

# 找 MongoDB collection
Grep "@Entity|@Collection"

# 找特定欄位
Grep "tokenAddress.*string"
```

### 找配置

```bash
# 主配置
Read {CONFIG_FILE}

# 環境配置
Glob "src/config/*.ts"

# 找特定配置項
Grep "redis|mongo|rpc" --glob "*.config.ts"
```

## 追蹤技巧

### 從 API 往下追

```
1. Grep 路由 → 找到 Controller
2. Read Controller → 找到 Service 調用
3. Read Service → 找到 Provider/Model 調用
4. Read Provider → 找到外部服務調用
```

### 從錯誤往上追

```
1. Grep 錯誤訊息 → 找到拋出點
2. 識別 caller → 往上找調用者
3. 重複直到找到入口
```

### 找相關測試

```bash
# 對應的單元測試
test/unit/service/{ServiceName}.test.ts

# 對應的整合測試
test/integration/controller/{ControllerName}.test.ts
```

## 常見陷阱

| 陷阱     | 解法                          |
| -------- | ----------------------------- |
| 循環依賴 | 檢查 lazy getter              |
| 動態載入 | 搜尋 `require()` / `import()` |
| 配置覆蓋 | 檢查環境變數 + config 層級    |
| 快取層   | 注意 Redis key pattern        |
