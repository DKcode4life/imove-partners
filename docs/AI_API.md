# AI Integration API

This document describes the API endpoints available for AI systems (like Claude AI assistant) to interact with the iMove CRM.

## Authentication

All API requests require an API key in the `Authorization` header:

```
Authorization: Bearer imv_fbd9d8943a7987281cb9b0d7666bb1672dc7cde049991a72
```

### API Key Format
- Starts with `imv_` followed by 48 hexadecimal characters
- Total length: 52 characters
- Example: `imv_fbd9d8943a7987281cb9b0d7666bb1672dc7cde049991a72`

### Scopes
Each API key has scopes that determine what it can access:
- `crm:read` - Read access to CRM data
- `crm:write` - Write access to update CRM data

The default key generated has both scopes: `crm:read,crm:write`

### Security Notes
- API keys are hashed in the database using bcrypt
- The full key is only shown once during generation
- Store keys securely (environment variables, password manager)
- To revoke a key: `UPDATE api_keys SET is_active = false WHERE id = <key_id>`
- To delete a key: `DELETE FROM api_keys WHERE id = <key_id>`

## Endpoints

### 1. Get All Jobs for AI Sync

**GET** `/api/crm/jobs/ai-sync`

Returns all CRM jobs with complete details for AI tracking.

#### Response Format
```json
{
  "synced_at": "2026-04-30T11:00:00Z",
  "count": 142,
  "jobs": [
    {
      "id": 123,
      "full_name": "John Smith",
      "email": "john@example.com",
      "phone": "07700 123456",
      "status": "Quote Sent",
      "status_color": "#3b82f6",
      "from_line1": "123 Main Street",
      "from_postcode": "SW1A 1AA",
      "to_line1": "456 Park Avenue",
      "to_postcode": "EC1A 1BB",
      "preferred_move_date": "2026-05-15",
      "confirmed_move_date": null,
      "quote_amount": 1250.00,
      "internal_notes": "Customer prefers morning move",
      "created_at": "2026-04-25T09:30:00Z",
      "updated_at": "2026-04-29T14:20:00Z",
      "lead": {
        "client_name": "John Smith",
        "current_address": "123 Main Street, London",
        "contact_number": "07700 123456",
        "email": "john@example.com",
        "estimated_moving_date": "2026-05-15"
      },
      "customer": {
        "id": 45,
        "full_name": "John Smith",
        "email": "john@example.com",
        "phone": "07700 123456"
      },
      "activities": [
        {
          "id": 891,
          "type": "note",
          "note": "Customer confirmed availability for survey",
          "created_at": "2026-04-28T10:15:00Z"
        }
      ],
      "quotes": [...],
      "invoices": [...],
      "documents": [...],
      "planner_assignments": [...],
      "change_logs": [...]
    }
  ]
}
```

#### cURL Example
```bash
curl -X GET "http://localhost:3001/api/crm/jobs/ai-sync" \
  -H "Authorization: Bearer imv_fbd9d8943a7987281cb9b0d7666bb1672dc7cde049991a72"
```

### 2. Update Job via AI

**PUT** `/api/crm/jobs/:id/ai-update`

Allows AI to update specific job fields. All updates are logged to the audit trail with `change_type='ai_update'`.

#### Request Body
At least one of these fields must be provided:

| Field | Type | Description |
|-------|------|-------------|
| `status_id` | integer | ID of the new status (from `job_statuses` table) |
| `status_name` | string | Name of the new status (alternative to `status_id`) |
| `notes` | string | Replace the `internal_notes` field completely |
| `append_notes` | string | Append to `internal_notes` with timestamp and "AI Update" prefix |

#### Response Format
```json
{
  "success": true,
  "message": "Job updated successfully",
  "job": {
    "id": 123,
    "status": "Quote Accepted",
    "internal_notes": "[2026-04-30] AI Update: Customer confirmed acceptance via email",
    "updated_at": "2026-04-30T11:05:00Z"
  },
  "changes": ["status", "internal_notes"]
}
```

#### cURL Examples

**Update status by name:**
```bash
curl -X PUT "http://localhost:3001/api/crm/jobs/123/ai-update" \
  -H "Authorization: Bearer imv_fbd9d8943a7987281cb9b0d7666bb1672dc7cde049991a72" \
  -H "Content-Type: application/json" \
  -d '{"status_name": "Quote Accepted"}'
```

**Append notes:**
```bash
curl -X PUT "http://localhost:3001/api/crm/jobs/123/ai-update" \
  -H "Authorization: Bearer imv_fbd9d8943a7987281cb9b0d7666bb1672dc7cde049991a72" \
  -H "Content-Type: application/json" \
  -d '{"append_notes": "Customer confirmed acceptance via email"}'
```

**Update status and replace notes:**
```bash
curl -X PUT "http://localhost:3001/api/crm/jobs/123/ai-update" \
  -H "Authorization: Bearer imv_fbd9d8943a7987281cb9b0d7666bb1672dc7cde049991a72" \
  -H "Content-Type: application/json" \
  -d '{
    "status_name": "Confirmed Deposit",
    "notes": "Deposit received. Awaiting final payment."
  }'
```

## Status Reference

Available status names (from `job_statuses` table):

| Status Name | Description |
|-------------|-------------|
| New Lead | New enquiry received |
| Called V/M | Called voicemail left |
| Contacted | Initial contact made |
| Survey Physical | Physical survey booked |
| Survey Video | Video survey booked |
| Quote Sent | Quote sent to customer |
| Quote Chased | Following up on quote |
| Most Likely | Very likely to book |
| Quote Accepted | Quote accepted by customer |
| Confirmed No Date | Confirmed but no date set |
| Confirmed Deposit | Deposit received |
| Confirmed Paid | Fully paid |
| Completed | Job completed |
| Archived / Review Done | Archived after review |
| Lost / Cancelled | Job lost or cancelled |

## Error Responses

### 400 Bad Request
```json
{
  "error": "At least one field must be provided (status_id, status_name, notes, or append_notes)"
}
```

### 401 Unauthorized
```json
{
  "error": "Invalid API key"
}
```

### 403 Forbidden
```json
{
  "error": "API key is inactive"
}
```

### 404 Not Found
```json
{
  "error": "Job not found"
}
```

### 500 Internal Server Error
```json
{
  "error": "Failed to update job"
}
```

## Implementation Notes for AI Systems

### Recommended Workflow
1. **Poll every 5-10 minutes**: Call `GET /api/crm/jobs/ai-sync` to get current state
2. **Process new/updated jobs**: Compare with previous sync to detect changes
3. **Take action**: Update statuses, add notes based on AI analysis
4. **Update via API**: Use `PUT /api/crm/jobs/:id/ai-update` for changes

### Data Freshness
- The `synced_at` timestamp indicates when the data was fetched
- Jobs are ordered by `updated_at` (most recently modified first)
- The AI should track the last `synced_at` to detect new changes

### Audit Trail
- All AI updates are logged to `JobChangeLog` with `change_type='ai_update'`
- Includes IP address and user agent for tracking
- Shows in the CRM audit trail UI as "AI Update"

## Testing

### Quick Test Script
```bash
#!/bin/bash

API_KEY="imv_fbd9d8943a7987281cb9b0d7666bb1672dc7cde049991a72"
BASE_URL="http://localhost:3001"

echo "Testing AI Sync endpoint..."
curl -s -X GET "$BASE_URL/api/crm/jobs/ai-sync" \
  -H "Authorization: Bearer $API_KEY" | jq '.count'

echo "Testing with invalid key..."
curl -s -X GET "$BASE_URL/api/crm/jobs/ai-sync" \
  -H "Authorization: Bearer invalid_key" | jq '.error'
```

### Using Postman
1. Create a new request
2. Set Authorization: Bearer Token
3. Token: `imv_fbd9d8943a7987281cb9b0d7666bb1672dc7cde049991a72`
4. Test both endpoints

## Generating New API Keys

```bash
# Generate a new key
node prisma/generate-api-key.js "New AI Integration"

# Generate with expiration
node prisma/generate-api-key.js "Temporary Access" --expires 2026-12-31
```

## Support

For issues with the API:
1. Check the server logs for authentication errors
2. Verify the API key is active in the database
3. Ensure the key has required scopes
4. Check CORS settings if calling from a different domain