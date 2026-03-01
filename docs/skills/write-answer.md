---
skill: write-answer
version: 1.0.0
last_updated: 2026-03-01
owner: agent-dsa
triggers:
  - "when all data collection is complete and the agent is ready to answer"
  - "when composing the final response to the user's question"
depends_on: []
---

## Scope

Building the final answer from collected observations, persisting it, and completing the run.

Does NOT cover: Data collection (see `listing-collection`, `detail-collection`), observation writing (see `write-observation`).

## Tool: `write_answer`

### Parameters

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `run_id` | string | yes | Current run identifier |
| `question_template_id` | string | no | Question template UUID (if applicable) |
| `question_text` | string | yes | The original question |
| `answer_text` | string | yes | Human-readable answer |
| `answer_data` | object | no | Structured answer data (JSON) |
| `confidence` | number | no | Overall confidence (0-1) |
| `sources_count` | number | no | Number of data sources used (default: 0) |

## Procedure

1. **Gather all observations** from the current run
2. **Compose `answer_text`**:
   - Summarize findings in natural language
   - Include key data points (prices, availability, comparisons)
   - Note any limitations or lower-confidence data
3. **Build `answer_data`** (structured):
   - Include relevant observation summaries
   - Include comparison tables if applicable
   - Include metadata (retailers covered, location, date)
4. **Compute `confidence`**:
   - Average of observation confidence scores
   - Weight by validation quality scores
   - Lower if fallback tier was used
5. **Count `sources_count`**:
   - Number of unique observations contributing to the answer
6. **Call `write_answer` tool**
7. **Run lifecycle updates**:
   - Answer inserted into `answers` table
   - Run `status` updated to `'completed'`
   - Run `finished_at` set to current timestamp

## One-Answer-Per-Run Constraint

```
answers (run_id) UNIQUE
```

- Each run produces exactly one answer
- If `write_answer` is called again for the same run, it will fail (unique constraint violation)
- The answer should be comprehensive — gather all data before writing

## Answer Status Lifecycle

```
pending -> ready   (successful answer)
pending -> error   (collection failed, answer describes the error)
```

## Success Criteria

- [ ] Answer text is clear, comprehensive, and addresses the original question
- [ ] Structured `answer_data` includes all relevant observations
- [ ] Confidence reflects actual data quality and coverage
- [ ] `sources_count` accurately counts contributing observations
- [ ] Run status updated to `'completed'` with `finished_at` timestamp
- [ ] Only one answer per run

## Examples

### Example: Best price answer
**Input:**
```json
{
  "run_id": "abc-123",
  "question_text": "What is the current price of Cheerios on Amazon?",
  "answer_text": "Cheerios Original 18 oz is currently $5.99 on Amazon (in stock). No active promotions detected. Unit price: $0.33/oz.",
  "answer_data": {
    "product": "Cheerios Original",
    "retailer": "Amazon",
    "shelf_price": 5.99,
    "promo_price": null,
    "unit_price": 0.33,
    "size_oz": 18,
    "in_stock": true,
    "source_url": "https://www.amazon.com/dp/B001E5E2M2"
  },
  "confidence": 0.95,
  "sources_count": 1
}
```

**Output:**
```json
{
  "success": true,
  "answer_id": "ans-xyz-456",
  "status": "ready"
}
```

### Example: Multi-retailer comparison
**Input:**
```json
{
  "run_id": "abc-456",
  "question_text": "Compare Cheerios prices across retailers in Chicago",
  "answer_text": "Cheerios 18 oz prices in Chicago (60601):\n- Walmart: $4.98\n- Amazon: $5.99\n- Target: $5.49\n- Kroger: $4.79 (with digital coupon)\n\nBest price: Kroger at $4.79. All retailers show in-stock.",
  "answer_data": {
    "comparison": [
      { "retailer": "Kroger", "price": 4.79, "promo": true },
      { "retailer": "Walmart", "price": 4.98, "promo": false },
      { "retailer": "Target", "price": 5.49, "promo": false },
      { "retailer": "Amazon", "price": 5.99, "promo": false }
    ],
    "best_price": { "retailer": "Kroger", "price": 4.79 }
  },
  "confidence": 0.9,
  "sources_count": 4
}
```

## Update Steps

1. If new answer fields are added to the schema, update the parameters table
2. If the one-answer-per-run constraint changes, update documentation
3. Source file: `agent/src/tools/write-results.ts` (writeAnswerTool)
