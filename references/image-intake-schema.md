# 图片识别输入契约

## 适用范围

当输入是发票照片、截图或扫描图片时，先由具备视觉能力的 Agent 读取图片，再按本契约生成 `extracted-invoices.json`。`ingest-images.js` 只校验和转换结构化结果，不自行调用云端 OCR。

## 数据格式

```json
{
  "invoices": [
    {
      "invoice_number": "12345678",
      "invoice_date": "2026-07-14",
      "invoice_type": "增值税普通发票",
      "total_amount": 368.00,
      "tax_amount": 0,
      "seller_name": "示例销售方",
      "buyer_name": "示例购买方",
      "items": "餐饮服务",
      "image_path": "C:/invoices/001.jpg",
      "confidence": {
        "invoice_number": 0.98,
        "invoice_date": 0.97,
        "invoice_type": 0.92,
        "total_amount": 0.99,
        "tax_amount": 0.90,
        "seller_name": 0.95,
        "buyer_name": 0.93
      }
    }
  ]
}
```

## 复核规则

- `total_amount`、`seller_name`、`buyer_name`、`invoice_date` 是必填字段。
- 必填字段必须附带 `0–1` 的字段级置信度。
- 默认阈值为 `0.85`，可用 `VISION_CONFIDENCE_THRESHOLD` 调整。
- 缺少发票号码、缺少置信度或任一必填字段低于阈值时，记录进入 `manual-tasks`，原因标记为 `VISION_LOW_CONFIDENCE`。
- 不要猜测看不清的字段；填 `null` 并降低置信度。
- 一张图片包含多张发票时，拆成多条记录，并让 `image_path` 指向同一原图。
- 发票与行程单同时出现时，把差旅字段放入 `trip`：`transportType`、`tripDate`、`fromStation`、`toStation`、`tripUncertain`。

## 隐私边界

视觉模型是否联网由宿主 Agent 决定。处理真实发票前必须说明模型与数据去向；未取得 `vision.process-images` 授权时，不读取图片。
