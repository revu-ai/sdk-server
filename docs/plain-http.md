# Plain HTTP

Any stack can report directly by posting to the [REVU API contract](./api-contract.md). Apply the same rules this package applies ([What is reported](./reporting.md) and [Privacy and data](./privacy.md)), send after the response is delivered, keep a short timeout, and never let a failure reach the request. Batch where your runtime allows it. Each `event_id` must be a UUID. Authenticate with the server key of the environment you report from (`revu_sk_prod_...` in production).

These snippets are illustrative starting points, each sending a single event.

## PHP

After the response, under PHP-FPM:

```php
<?php
fastcgi_finish_request(); // response is delivered, the rest runs after
$id = random_bytes(16);
$id[6] = chr(ord($id[6]) & 0x0f | 0x40); // UUID version 4
$id[8] = chr(ord($id[8]) & 0x3f | 0x80); // RFC 4122 variant
$event = [
  'event_type' => '$crawl',
  'event_id' => vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($id), 4)),
  'timestamp' => gmdate('Y-m-d\TH:i:s.v\Z'),
  'host' => strtolower($_SERVER['HTTP_HOST'] ?? ''),
  'path' => strtok($_SERVER['REQUEST_URI'], '?'),
  'method' => $_SERVER['REQUEST_METHOD'],
  'status' => http_response_code(),
  'user_agent' => $_SERVER['HTTP_USER_AGENT'] ?? '',
  'ip' => $_SERVER['REMOTE_ADDR'] ?? null,
  'referer_host' => parse_url($_SERVER['HTTP_REFERER'] ?? '', PHP_URL_HOST) ?: null,
];
$ch = curl_init('https://api.revu.ai/v1/behavior/server-events');
curl_setopt_array($ch, [
  CURLOPT_POST => true,
  CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Authorization: Bearer ' . getenv('REVU_SERVER_KEY')],
  CURLOPT_POSTFIELDS => json_encode(['sdk' => ['name' => 'custom-php', 'version' => '1'], 'events' => [$event]]),
  CURLOPT_TIMEOUT_MS => 3000,
  CURLOPT_RETURNTRANSFER => true,
]);
@curl_exec($ch);
```

## Python

Standard library, off the request thread:

```python
import json, os, threading, urllib.request, uuid
from datetime import datetime, timezone

def report(event):
    def send():
        body = json.dumps({"sdk": {"name": "custom-python", "version": "1"}, "events": [event]}).encode()
        req = urllib.request.Request(
            "https://api.revu.ai/v1/behavior/server-events",
            data=body,
            headers={"Content-Type": "application/json",
                     "Authorization": "Bearer " + os.environ["REVU_SERVER_KEY"]},
        )
        try:
            urllib.request.urlopen(req, timeout=3).close()
        except Exception:
            pass  # never let reporting fail a request
    threading.Thread(target=send, daemon=True).start()

report({
    "event_type": "$crawl", "event_id": str(uuid.uuid4()),
    "timestamp": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
    "host": "shop.example", "path": "/pricing", "method": "GET", "status": 200,
    "user_agent": "curl/8.7.1", "ip": "203.0.113.7", "referer_host": None,
})
```

## Ruby

Standard library, off the request thread:

```ruby
require "net/http"
require "json"
require "securerandom"
require "time"

def revu_report(event)
  Thread.new do
    uri = URI("https://api.revu.ai/v1/behavior/server-events")
    Net::HTTP.start(uri.host, uri.port, use_ssl: true, open_timeout: 3, read_timeout: 3) do |http|
      http.post(uri.path,
                { sdk: { name: "custom-ruby", version: "1" }, events: [event] }.to_json,
                "Content-Type" => "application/json",
                "Authorization" => "Bearer #{ENV.fetch("REVU_SERVER_KEY")}")
    end
  rescue StandardError
    nil # never let reporting fail a request
  end
end

revu_report(event_type: "$crawl", event_id: SecureRandom.uuid, timestamp: Time.now.utc.iso8601(3),
            host: "shop.example", path: "/pricing", method: "GET", status: 200,
            user_agent: "curl/8.7.1", ip: "203.0.113.7", referer_host: nil)
```

## Before you ship your own

- Report only page-like GET and HEAD requests from clients that look automated, as [What is reported](./reporting.md) describes. Everything else is wasted volume.
- Strip the query string and reduce the referer to its host, as [Privacy and data](./privacy.md) describes.
- Read forwarding headers only behind a proxy you control, see [Client IP and proxies](./client-ip.md).
- React to each response as the [contract](./api-contract.md#responses) describes: stop on `401` or `403`, wait for `Retry-After` on `429`.
