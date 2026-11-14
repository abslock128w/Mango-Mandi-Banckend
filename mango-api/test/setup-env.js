// Imported first by every test file, before any src module reads process.env.
// Tests drop and recreate the schema, so they only ever use a *_test database.
process.env.NODE_ENV = 'test'
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://mango:mango@localhost:5432/mango_test'
if (!/_test(\?|$)/.test(process.env.DATABASE_URL)) throw new Error('TEST_DATABASE_URL must point at a database whose name ends in _test')
process.env.COOKIE_SECURE = 'false'
process.env.LOG_LEVEL ??= 'silent'
process.env.SEED_DEMO_DATA = 'false'
process.env.REFRESH_REUSE_GRACE_MS = '2000'
process.env.ENABLE_DEV_ROUTES = 'true'
// The event stream (GET /admin/v1/events) ends quickly, so the route walks that read every answer to the end finish.
process.env.EVENTS_STREAM_MS ??= '300'
process.env.EVENTS_LISTEN_LINGER_MS ??= '0'
// The warehouse routes are on in tests so the role matrix covers them; every product still starts with box tracking off.
process.env.WAREHOUSE_V2 ??= 'true'
// Backorders are on by default; the older suites check STOCK_INSUFFICIENT, so they run with them off (backorders.test.js turns them on).
process.env.BACKORDERS ??= 'false'
process.env.WAREHOUSE_STOCKTAKE ??= 'true'
process.env.WAREHOUSE_REPACK ??= 'true'
process.env.WAREHOUSE_CAMERA_SCAN ??= 'true'
process.env.RAZORPAY_KEY_ID = ''
process.env.RAZORPAY_KEY_SECRET = ''
process.env.WHATSAPP_APP_SECRET = 'wa_test_secret'
process.env.WHATSAPP_VERIFY_TOKEN = 'wa_verify_test'
process.env.CRON_SECRET = 'cron_test_secret_0123456789'
process.env.GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com'
