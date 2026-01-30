# Logging Rules

日誌級別: error(立即處理) | warn(潛在問題) | info(業務事件) | debug(調試)

禁止記錄: 私鑰 | 助記詞 | API keys | 密碼 | 完整地址（可記錄前後 6 位）

必須包含: traceId | service | method

格式: JSON 結構化日誌
