---
name: testing
description: "Testing pyramid, unit/integration/e2e, mocking (Jest/pytest/Go), test doubles, property-based testing, CI patterns, coverage, flaky tests, fixtures, and test architecture."
domain: general
version: "1.0"
---

# Testing Reference Dictionary

## Testing Pyramid

### Layer Overview

```
                    /  E2E Tests  \        <- Few, slow, expensive
                   / (Cypress/PW)  \          Real browser/services
                  /________________\
                 / Integration Tests \     <- Medium count, moderate speed
                / (Supertest/pytest)  \       Real DB, HTTP, queues
               /______________________\
              /      Unit Tests         \  <- Many, fast, cheap
             /  (Jest/pytest/go test)    \    Isolated, no I/O
            /____________________________\

# Rule of thumb:
# 70% Unit | 20% Integration | 10% E2E
# But adjust to your codebase — some apps need more integration tests
```

### When to Use Each Level

```
Unit Tests:
  - Pure functions and business logic
  - Data transformations and validation
  - State machines and algorithms
  - Error handling branches
  - Utilities and helpers
  - Fast feedback (< 1ms per test)

Integration Tests:
  - Database queries (real DB, test schema)
  - API endpoint behavior (HTTP in -> response out)
  - Service-to-service communication
  - Queue/event processing
  - Authentication and authorization flows
  - File system operations
  - Cache behavior

E2E Tests:
  - Critical user journeys (signup, checkout, payment)
  - Cross-service workflows
  - UI interaction flows
  - Happy path smoke tests
  - Regression tests for past production bugs
```

## Unit Testing

### Jest (JavaScript/TypeScript)

```javascript
// Basic test structure
describe('UserService', () => {
  let service;
  let mockRepository;

  beforeEach(() => {
    mockRepository = {
      findById: jest.fn(),
      save: jest.fn(),
      delete: jest.fn(),
    };
    service = new UserService(mockRepository);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getUser', () => {
    it('should return user when found', async () => {
      const user = { id: '1', name: 'Alice', email: 'alice@example.com' };
      mockRepository.findById.mockResolvedValue(user);

      const result = await service.getUser('1');

      expect(result).toEqual(user);
      expect(mockRepository.findById).toHaveBeenCalledWith('1');
      expect(mockRepository.findById).toHaveBeenCalledTimes(1);
    });

    it('should throw NotFoundError when user does not exist', async () => {
      mockRepository.findById.mockResolvedValue(null);

      await expect(service.getUser('999')).rejects.toThrow(NotFoundError);
    });

    it('should propagate repository errors', async () => {
      mockRepository.findById.mockRejectedValue(new Error('DB connection failed'));

      await expect(service.getUser('1')).rejects.toThrow('DB connection failed');
    });
  });

  describe('createUser', () => {
    it('should hash password before saving', async () => {
      mockRepository.save.mockResolvedValue({ id: '1' });

      await service.createUser({ name: 'Bob', email: 'bob@example.com', password: 'secret' });

      const savedUser = mockRepository.save.mock.calls[0][0];
      expect(savedUser.password).not.toBe('secret');
      expect(savedUser.password).toMatch(/^\$2[aby]\$.+/); // bcrypt hash
    });

    it('should reject duplicate email', async () => {
      mockRepository.save.mockRejectedValue(new DuplicateError('email'));

      await expect(service.createUser({
        name: 'Bob', email: 'existing@example.com', password: 'secret'
      })).rejects.toThrow('Email already exists');
    });
  });
});

// Snapshot testing
describe('formatInvoice', () => {
  it('should format invoice correctly', () => {
    const invoice = formatInvoice({ items: [{ name: 'Widget', qty: 2, price: 9.99 }] });
    expect(invoice).toMatchSnapshot();
    // First run creates snapshot; subsequent runs compare against it
    // Update snapshots: jest --updateSnapshot
  });

  it('should use inline snapshot', () => {
    expect(formatCurrency(1234.5)).toMatchInlineSnapshot(`"$1,234.50"`);
  });
});

// Testing timers
describe('debounce', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('should call function after delay', () => {
    const fn = jest.fn();
    const debounced = debounce(fn, 300);

    debounced('arg1');
    expect(fn).not.toHaveBeenCalled();

    jest.advanceTimersByTime(299);
    expect(fn).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledWith('arg1');
  });
});

// Testing errors and exceptions
it('should handle async errors', async () => {
  // Promise rejection
  await expect(asyncFunction()).rejects.toThrow('Expected error');

  // Error properties
  await expect(asyncFunction()).rejects.toMatchObject({
    message: 'Not found',
    status: 404,
  });

  // Sync throw
  expect(() => parseConfig('invalid')).toThrow(ValidationError);
});
```

### Pytest (Python)

```python
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

# Basic test functions (no class needed)
def test_calculate_discount():
    assert calculate_discount(100, 0.1) == 90.0
    assert calculate_discount(100, 0) == 100.0
    assert calculate_discount(0, 0.5) == 0.0

def test_calculate_discount_invalid_rate():
    with pytest.raises(ValueError, match="Discount rate must be between 0 and 1"):
        calculate_discount(100, 1.5)

# Fixtures: setup/teardown
@pytest.fixture
def user():
    return User(name="Alice", email="alice@example.com")

@pytest.fixture
def mock_db():
    db = MagicMock()
    db.query.return_value = []
    return db

@pytest.fixture
async def async_client(app):
    """Async HTTP test client."""
    async with AsyncClient(app=app, base_url="http://test") as client:
        yield client

def test_user_full_name(user):
    assert user.full_name == "Alice"

# Parameterized tests
@pytest.mark.parametrize("input_val,expected", [
    ("hello", "HELLO"),
    ("", ""),
    ("Hello World", "HELLO WORLD"),
    ("123", "123"),
])
def test_uppercase(input_val, expected):
    assert to_upper(input_val) == expected

@pytest.mark.parametrize("email,valid", [
    ("user@example.com", True),
    ("user@example", False),
    ("@example.com", False),
    ("user@.com", False),
    ("", False),
])
def test_validate_email(email, valid):
    assert is_valid_email(email) == valid

# Async test
@pytest.mark.asyncio
async def test_fetch_user(mock_db):
    service = UserService(mock_db)
    mock_db.find_one = AsyncMock(return_value={"id": 1, "name": "Alice"})

    user = await service.get_user(1)

    assert user.name == "Alice"
    mock_db.find_one.assert_awaited_once_with({"id": 1})

# Patching/mocking
@patch("myapp.services.external_api.fetch")
def test_sync_data(mock_fetch):
    mock_fetch.return_value = {"status": "ok", "data": [1, 2, 3]}

    result = sync_data()

    assert result.count == 3
    mock_fetch.assert_called_once()

# Context manager for patching
def test_with_env_vars():
    with patch.dict("os.environ", {"API_KEY": "test-key", "DEBUG": "1"}):
        config = load_config()
        assert config.api_key == "test-key"

# Temporary files and directories
def test_export_csv(tmp_path):
    output_file = tmp_path / "export.csv"
    export_to_csv(data, output_file)

    content = output_file.read_text()
    assert "Alice,alice@example.com" in content

# Marks for conditional execution
@pytest.mark.slow
def test_large_dataset_processing():
    """Run with: pytest -m slow"""
    pass

@pytest.mark.skipif(sys.platform == "win32", reason="Not supported on Windows")
def test_unix_specific():
    pass
```

### Go Testing

```go
package user

import (
    "context"
    "errors"
    "testing"
)

// Basic test
func TestCalculateDiscount(t *testing.T) {
    got := CalculateDiscount(100, 0.1)
    want := 90.0
    if got != want {
        t.Errorf("CalculateDiscount(100, 0.1) = %f, want %f", got, want)
    }
}

// Table-driven tests (Go convention)
func TestValidateEmail(t *testing.T) {
    tests := []struct {
        name    string
        email   string
        wantErr bool
    }{
        {"valid email", "user@example.com", false},
        {"missing domain", "user@", true},
        {"missing at sign", "userexample.com", true},
        {"empty string", "", true},
        {"with plus", "user+tag@example.com", false},
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            err := ValidateEmail(tt.email)
            if (err != nil) != tt.wantErr {
                t.Errorf("ValidateEmail(%q) error = %v, wantErr %v", tt.email, err, tt.wantErr)
            }
        })
    }
}

// Subtests with setup
func TestUserService(t *testing.T) {
    // Setup
    repo := &MockRepository{}
    service := NewUserService(repo)

    t.Run("GetUser returns user when found", func(t *testing.T) {
        repo.FindByIDFunc = func(ctx context.Context, id string) (*User, error) {
            return &User{ID: id, Name: "Alice"}, nil
        }

        user, err := service.GetUser(context.Background(), "1")
        if err != nil {
            t.Fatalf("unexpected error: %v", err)
        }
        if user.Name != "Alice" {
            t.Errorf("got name %q, want %q", user.Name, "Alice")
        }
    })

    t.Run("GetUser returns error when not found", func(t *testing.T) {
        repo.FindByIDFunc = func(ctx context.Context, id string) (*User, error) {
            return nil, ErrNotFound
        }

        _, err := service.GetUser(context.Background(), "999")
        if !errors.Is(err, ErrNotFound) {
            t.Errorf("got error %v, want ErrNotFound", err)
        }
    })
}

// Interface-based mock
type MockRepository struct {
    FindByIDFunc func(ctx context.Context, id string) (*User, error)
    SaveFunc     func(ctx context.Context, u *User) error
}

func (m *MockRepository) FindByID(ctx context.Context, id string) (*User, error) {
    return m.FindByIDFunc(ctx, id)
}

func (m *MockRepository) Save(ctx context.Context, u *User) error {
    return m.SaveFunc(ctx, u)
}

// Test helpers
func TestMain(m *testing.M) {
    // Global setup (e.g., database migration)
    setup()
    code := m.Run()
    // Global teardown
    teardown()
    os.Exit(code)
}

// Helper with t.Helper()
func assertEqual(t *testing.T, got, want interface{}) {
    t.Helper() // report caller's line number on failure
    if got != want {
        t.Errorf("got %v, want %v", got, want)
    }
}

// Benchmarks
func BenchmarkParseJSON(b *testing.B) {
    data := []byte(`{"name": "Alice", "age": 30}`)
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        ParseJSON(data)
    }
}

// Fuzzing (Go 1.18+)
func FuzzParseEmail(f *testing.F) {
    // Seed corpus
    f.Add("user@example.com")
    f.Add("")
    f.Add("@")

    f.Fuzz(func(t *testing.T, email string) {
        // Should never panic
        _, _ = ParseEmail(email)
    })
}
```

## Test Doubles

### Types of Test Doubles

```javascript
// 1. STUB: Returns predetermined values (no behavior verification)
const stubRepo = {
  findById: () => ({ id: '1', name: 'Alice' }),  // always returns Alice
  count: () => 42,
};

// 2. MOCK: Records calls, verifies interactions
const mockEmailService = {
  send: jest.fn().mockResolvedValue({ messageId: 'abc' }),
};
// After test:
expect(mockEmailService.send).toHaveBeenCalledWith({
  to: 'alice@example.com',
  subject: 'Welcome',
});

// 3. FAKE: Working implementation with shortcuts
class FakeUserRepository {
  constructor() {
    this.users = new Map();
  }
  async findById(id) {
    return this.users.get(id) || null;
  }
  async save(user) {
    this.users.set(user.id, user);
    return user;
  }
  async delete(id) {
    this.users.delete(id);
  }
  async count() {
    return this.users.size;
  }
}

// 4. SPY: Wraps real implementation, records calls
const realService = new NotificationService();
const spy = jest.spyOn(realService, 'send');
// Real method executes, but calls are recorded
await realService.send('hello');
expect(spy).toHaveBeenCalledWith('hello');

// 5. DUMMY: Placeholder, never actually used
const dummyLogger = { log: () => {}, error: () => {}, warn: () => {} };
const service = new UserService(realRepo, dummyLogger);
```

### Mocking Patterns

```javascript
// Module mocking (Jest)
jest.mock('./emailService', () => ({
  sendEmail: jest.fn().mockResolvedValue({ sent: true }),
}));

// Partial mock (keep some real implementations)
jest.mock('./utils', () => ({
  ...jest.requireActual('./utils'),
  generateId: jest.fn().mockReturnValue('fixed-id'),
}));

// Mock implementation that varies by call
const mockFetch = jest.fn()
  .mockResolvedValueOnce({ status: 200, json: () => ({ data: 'first' }) })
  .mockResolvedValueOnce({ status: 200, json: () => ({ data: 'second' }) })
  .mockRejectedValueOnce(new Error('Network error'));

// Dynamic mock implementation
mockRepo.findById.mockImplementation((id) => {
  const users = { '1': { name: 'Alice' }, '2': { name: 'Bob' } };
  return Promise.resolve(users[id] || null);
});

// Mock date/time
jest.useFakeTimers().setSystemTime(new Date('2024-03-15'));
// ... test code that uses Date.now() or new Date() ...
jest.useRealTimers();

// Mock environment variables
const originalEnv = process.env;
beforeEach(() => {
  process.env = { ...originalEnv, API_KEY: 'test-key' };
});
afterEach(() => {
  process.env = originalEnv;
});
```

```python
# Python: unittest.mock patterns
from unittest.mock import MagicMock, AsyncMock, patch, PropertyMock, call

# Mock with spec (type safety)
mock_service = MagicMock(spec=UserService)
mock_service.get_user.return_value = User(id=1, name="Alice")

# Verify call args
mock_service.get_user.assert_called_once_with(1)
mock_service.get_user.assert_any_call(1)

# Check call order
mock_service.assert_has_calls([
    call.get_user(1),
    call.update_user(1, name="Bob"),
], any_order=False)

# Side effects
mock_service.get_user.side_effect = [
    User(id=1, name="Alice"),   # first call
    NotFoundException("Not found"),  # second call raises
]

# Property mock
type(mock_service).name = PropertyMock(return_value="Test Service")

# Context manager mock
mock_file = MagicMock()
mock_file.__enter__ = MagicMock(return_value=mock_file)
mock_file.__exit__ = MagicMock(return_value=False)

# Async mock
mock_client = AsyncMock()
mock_client.fetch.return_value = {"status": "ok"}
result = await mock_client.fetch("/api/data")
```

## Integration Testing

### Database Integration Tests

```javascript
// Jest + PostgreSQL (using testcontainers or test database)
const { Pool } = require('pg');

describe('UserRepository', () => {
  let pool;
  let repo;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    repo = new UserRepository(pool);
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM users');
  });

  afterAll(async () => {
    await pool.end();
  });

  it('should create and retrieve a user', async () => {
    const created = await repo.create({ name: 'Alice', email: 'alice@test.com' });
    expect(created.id).toBeDefined();

    const found = await repo.findById(created.id);
    expect(found).toMatchObject({ name: 'Alice', email: 'alice@test.com' });
  });

  it('should enforce unique email', async () => {
    await repo.create({ name: 'Alice', email: 'alice@test.com' });

    await expect(
      repo.create({ name: 'Bob', email: 'alice@test.com' })
    ).rejects.toThrow(/unique/i);
  });

  it('should paginate results', async () => {
    // Insert 25 users
    for (let i = 1; i <= 25; i++) {
      await repo.create({ name: `User ${i}`, email: `user${i}@test.com` });
    }

    const page1 = await repo.list({ page: 1, perPage: 10 });
    expect(page1.data).toHaveLength(10);
    expect(page1.totalCount).toBe(25);

    const page3 = await repo.list({ page: 3, perPage: 10 });
    expect(page3.data).toHaveLength(5);
  });
});
```

### API Integration Tests

```javascript
// Supertest for Express.js
const request = require('supertest');
const app = require('../app');

describe('POST /api/users', () => {
  it('should create a user and return 201', async () => {
    const res = await request(app)
      .post('/api/users')
      .send({ name: 'Alice', email: 'alice@example.com' })
      .set('Authorization', `Bearer ${testToken}`)
      .expect(201)
      .expect('Content-Type', /json/);

    expect(res.body).toMatchObject({
      id: expect.any(String),
      name: 'Alice',
      email: 'alice@example.com',
    });
    expect(res.headers.location).toMatch(/\/api\/users\/\w+/);
  });

  it('should return 422 for invalid email', async () => {
    const res = await request(app)
      .post('/api/users')
      .send({ name: 'Alice', email: 'not-an-email' })
      .set('Authorization', `Bearer ${testToken}`)
      .expect(422);

    expect(res.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'email' }),
      ])
    );
  });

  it('should return 401 without authentication', async () => {
    await request(app)
      .post('/api/users')
      .send({ name: 'Alice', email: 'alice@example.com' })
      .expect(401);
  });
});
```

```python
# pytest with FastAPI TestClient
from fastapi.testclient import TestClient
from httpx import AsyncClient
import pytest

# Synchronous
def test_create_user(client: TestClient, auth_headers):
    response = client.post(
        "/api/users",
        json={"name": "Alice", "email": "alice@example.com"},
        headers=auth_headers,
    )
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Alice"
    assert "id" in data

# Async with httpx
@pytest.mark.asyncio
async def test_list_users(async_client: AsyncClient, auth_headers):
    # Create some users
    for i in range(5):
        await async_client.post(
            "/api/users",
            json={"name": f"User {i}", "email": f"user{i}@test.com"},
            headers=auth_headers,
        )

    response = await async_client.get("/api/users?per_page=3", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert len(data["data"]) == 3
    assert data["pagination"]["total_count"] == 5

# Fixture: test database with rollback
@pytest.fixture
async def db_session():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with AsyncSession(engine) as session:
        async with session.begin():
            yield session
            await session.rollback()  # rollback all changes after test
```

### Testcontainers

```javascript
// Testcontainers: real database in Docker for tests
const { GenericContainer } = require('testcontainers');

let container;
let connectionString;

beforeAll(async () => {
  container = await new GenericContainer('postgres:16-alpine')
    .withEnvironment({
      POSTGRES_DB: 'testdb',
      POSTGRES_USER: 'test',
      POSTGRES_PASSWORD: 'test',
    })
    .withExposedPorts(5432)
    .start();

  const port = container.getMappedPort(5432);
  connectionString = `postgres://test:test@localhost:${port}/testdb`;
}, 30000); // 30s timeout for container startup

afterAll(async () => {
  await container.stop();
});
```

```python
# Python testcontainers
import pytest
from testcontainers.postgres import PostgresContainer

@pytest.fixture(scope="session")
def postgres():
    with PostgresContainer("postgres:16-alpine") as pg:
        yield pg.get_connection_url()

@pytest.fixture
def db(postgres):
    engine = create_engine(postgres)
    Base.metadata.create_all(engine)
    yield engine
    Base.metadata.drop_all(engine)
```

## End-to-End Testing

### Playwright

```javascript
// playwright.config.js
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  use: {
    baseURL: 'http://localhost:3000',
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
    video: 'on-first-retry',
  },
  webServer: {
    command: 'npm run start',
    port: 3000,
    reuseExistingServer: !process.env.CI,
  },
});
```

```javascript
// e2e/auth.spec.js
import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
  test('should allow user to sign up and log in', async ({ page }) => {
    // Sign up
    await page.goto('/signup');
    await page.fill('[data-testid="email"]', 'newuser@example.com');
    await page.fill('[data-testid="password"]', 'SecureP@ss123');
    await page.fill('[data-testid="confirm-password"]', 'SecureP@ss123');
    await page.click('[data-testid="signup-button"]');

    // Should redirect to dashboard
    await expect(page).toHaveURL('/dashboard');
    await expect(page.locator('[data-testid="welcome-message"]'))
      .toContainText('Welcome');

    // Log out
    await page.click('[data-testid="logout-button"]');
    await expect(page).toHaveURL('/login');

    // Log back in
    await page.fill('[data-testid="email"]', 'newuser@example.com');
    await page.fill('[data-testid="password"]', 'SecureP@ss123');
    await page.click('[data-testid="login-button"]');
    await expect(page).toHaveURL('/dashboard');
  });

  test('should show validation errors for invalid input', async ({ page }) => {
    await page.goto('/signup');
    await page.click('[data-testid="signup-button"]');

    await expect(page.locator('[data-testid="email-error"]'))
      .toContainText('Email is required');
    await expect(page.locator('[data-testid="password-error"]'))
      .toContainText('Password is required');
  });
});

// Page Object Model (POM)
class LoginPage {
  constructor(page) {
    this.page = page;
    this.emailInput = page.locator('[data-testid="email"]');
    this.passwordInput = page.locator('[data-testid="password"]');
    this.loginButton = page.locator('[data-testid="login-button"]');
    this.errorMessage = page.locator('[data-testid="error-message"]');
  }

  async goto() {
    await this.page.goto('/login');
  }

  async login(email, password) {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.loginButton.click();
  }
}

test('login with POM', async ({ page }) => {
  const loginPage = new LoginPage(page);
  await loginPage.goto();
  await loginPage.login('user@example.com', 'password');
  await expect(page).toHaveURL('/dashboard');
});
```

### Cypress

```javascript
// cypress/e2e/checkout.cy.js
describe('Checkout Flow', () => {
  beforeEach(() => {
    cy.login('user@example.com', 'password'); // custom command
    cy.visit('/products');
  });

  it('should complete a purchase', () => {
    // Add item to cart
    cy.get('[data-testid="product-card"]').first().within(() => {
      cy.get('[data-testid="add-to-cart"]').click();
    });

    // Go to cart
    cy.get('[data-testid="cart-badge"]').should('contain', '1');
    cy.get('[data-testid="cart-icon"]').click();

    // Checkout
    cy.get('[data-testid="checkout-button"]').click();

    // Fill shipping
    cy.get('#address').type('123 Main St');
    cy.get('#city').type('Anytown');
    cy.get('#zip').type('12345');

    // Submit order
    cy.get('[data-testid="place-order"]').click();

    // Verify confirmation
    cy.url().should('include', '/order-confirmation');
    cy.get('[data-testid="order-number"]').should('exist');

    // Intercept and verify API call
    cy.intercept('POST', '/api/orders').as('createOrder');
    cy.wait('@createOrder').its('response.statusCode').should('eq', 201);
  });
});

// Custom commands (cypress/support/commands.js)
Cypress.Commands.add('login', (email, password) => {
  cy.session([email, password], () => {
    cy.request('POST', '/api/auth/login', { email, password }).then(({ body }) => {
      window.localStorage.setItem('token', body.accessToken);
    });
  });
});
```

## Property-Based Testing

### fast-check (JavaScript)

```javascript
import fc from 'fast-check';

// Property: sort is idempotent
test('sorting twice gives same result as sorting once', () => {
  fc.assert(
    fc.property(fc.array(fc.integer()), (arr) => {
      const sorted1 = mySort([...arr]);
      const sorted2 = mySort([...sorted1]);
      expect(sorted2).toEqual(sorted1);
    })
  );
});

// Property: parse is inverse of serialize
test('parse(serialize(x)) === x', () => {
  fc.assert(
    fc.property(
      fc.record({
        name: fc.string(),
        age: fc.integer({ min: 0, max: 150 }),
        tags: fc.array(fc.string()),
      }),
      (user) => {
        const serialized = serialize(user);
        const parsed = parse(serialized);
        expect(parsed).toEqual(user);
      }
    )
  );
});

// Property: encoding/decoding roundtrip
test('base64 decode(encode(x)) === x', () => {
  fc.assert(
    fc.property(fc.uint8Array(), (bytes) => {
      const encoded = base64Encode(bytes);
      const decoded = base64Decode(encoded);
      expect(decoded).toEqual(bytes);
    })
  );
});

// Custom arbitraries
const emailArb = fc.tuple(
  fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'), { minLength: 1, maxLength: 20 }),
  fc.constantFrom('example.com', 'test.org', 'mail.co')
).map(([local, domain]) => `${local}@${domain}`);

test('email validation accepts valid emails', () => {
  fc.assert(
    fc.property(emailArb, (email) => {
      expect(isValidEmail(email)).toBe(true);
    })
  );
});
```

### Hypothesis (Python)

```python
from hypothesis import given, strategies as st, assume, settings

@given(st.lists(st.integers()))
def test_sort_preserves_length(xs):
    assert len(sorted(xs)) == len(xs)

@given(st.lists(st.integers()))
def test_sort_produces_ordered_output(xs):
    result = sorted(xs)
    for i in range(len(result) - 1):
        assert result[i] <= result[i + 1]

@given(st.dictionaries(
    keys=st.text(min_size=1, max_size=50),
    values=st.one_of(st.integers(), st.text(), st.booleans(), st.none()),
    max_size=20,
))
def test_json_roundtrip(d):
    assert json.loads(json.dumps(d)) == d

# Custom strategy
@st.composite
def valid_user(draw):
    return {
        "name": draw(st.text(min_size=1, max_size=100)),
        "age": draw(st.integers(min_value=0, max_value=150)),
        "email": draw(st.emails()),
    }

@given(valid_user())
def test_create_user_accepts_valid_input(user):
    result = create_user(user)
    assert result.name == user["name"]

# Stateful testing
from hypothesis.stateful import RuleBasedStateMachine, rule, initialize

class DatabaseModel(RuleBasedStateMachine):
    @initialize()
    def setup(self):
        self.db = InMemoryDB()
        self.model = {}  # our oracle

    @rule(key=st.text(min_size=1), value=st.integers())
    def put(self, key, value):
        self.db.put(key, value)
        self.model[key] = value

    @rule(key=st.text(min_size=1))
    def get(self, key):
        db_result = self.db.get(key)
        model_result = self.model.get(key)
        assert db_result == model_result

    @rule(key=st.text(min_size=1))
    def delete(self, key):
        self.db.delete(key)
        self.model.pop(key, None)

TestDatabase = DatabaseModel.TestCase
```

## Test Architecture

### Factories and Builders

```javascript
// Factory pattern for test data
class UserFactory {
  static defaults = {
    name: 'Test User',
    email: 'test@example.com',
    status: 'active',
    role: 'user',
  };

  static build(overrides = {}) {
    const seq = UserFactory._seq++;
    return {
      ...UserFactory.defaults,
      email: `user${seq}@example.com`,
      ...overrides,
    };
  }
  static _seq = 1;

  static async create(overrides = {}) {
    const data = UserFactory.build(overrides);
    return db.users.create({ data });
  }

  static async createMany(count, overrides = {}) {
    return Promise.all(
      Array.from({ length: count }, () => UserFactory.create(overrides))
    );
  }
}

// Usage
const user = UserFactory.build({ role: 'admin' });
const dbUser = await UserFactory.create({ name: 'Alice' });
const users = await UserFactory.createMany(10, { status: 'active' });
```

```python
# Factory Boy (Python)
import factory
from factory import Faker, SubFactory, LazyAttribute

class UserFactory(factory.Factory):
    class Meta:
        model = User

    name = Faker("name")
    email = factory.Sequence(lambda n: f"user{n}@example.com")
    status = "active"
    role = "user"

class OrderFactory(factory.Factory):
    class Meta:
        model = Order

    user = SubFactory(UserFactory)
    total = Faker("pydecimal", left_digits=4, right_digits=2, positive=True)
    status = "pending"
    created_at = Faker("date_time_this_year")

# Usage
user = UserFactory(role="admin")
order = OrderFactory(user=user, status="completed")
users = UserFactory.create_batch(10)
```

## CI Integration

### GitHub Actions Test Workflow

```yaml
name: Tests
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: [18, 20]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: npm
      - run: npm ci
      - run: npm test -- --coverage
      - uses: codecov/codecov-action@v4
        with:
          token: ${{ secrets.CODECOV_TOKEN }}

  integration-tests:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_DB: testdb
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
      redis:
        image: redis:7-alpine
        ports:
          - 6379:6379
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run test:integration
        env:
          DATABASE_URL: postgres://test:test@localhost:5432/testdb
          REDIS_URL: redis://localhost:6379

  e2e-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npx playwright install --with-deps
      - run: npm run test:e2e
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: playwright-report/
```

## Coverage

### Coverage Configuration

```javascript
// jest.config.js
module.exports = {
  collectCoverageFrom: [
    'src/**/*.{js,ts}',
    '!src/**/*.d.ts',
    '!src/**/index.ts',       // barrel files
    '!src/**/*.test.{js,ts}',
    '!src/test/**',
  ],
  coverageThresholds: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
    // Stricter thresholds for critical code
    './src/auth/': {
      branches: 95,
      functions: 95,
      lines: 95,
    },
  },
};
```

```ini
# .coveragerc (Python)
[run]
source = src
omit =
    src/tests/*
    src/migrations/*
    src/__init__.py

[report]
fail_under = 80
show_missing = true
exclude_lines =
    pragma: no cover
    def __repr__
    raise NotImplementedError
    if TYPE_CHECKING:
    @abstract
```

### Coverage Anti-Patterns

```
# DON'T chase 100% coverage — it leads to low-value tests
# DON'T write tests just to hit coverage (testing getters/setters)
# DON'T exclude important code to inflate numbers

# DO focus coverage on:
# - Business logic and complex algorithms
# - Error handling paths
# - Edge cases and boundary conditions
# - Security-critical code (auth, input validation)

# DO use coverage to find UNTESTED code, not to prove code is correct
# High coverage with bad assertions = false confidence
```

## Flaky Tests

### Common Causes and Fixes

```javascript
// CAUSE 1: Time-dependent tests
// BAD:
test('token expires', () => {
  const token = createToken({ expiresAt: Date.now() + 1000 });
  sleep(1100);
  expect(isExpired(token)).toBe(true);
});

// GOOD: Inject time
test('token expires', () => {
  jest.useFakeTimers();
  const token = createToken({ expiresAt: Date.now() + 1000 });
  jest.advanceTimersByTime(1001);
  expect(isExpired(token)).toBe(true);
  jest.useRealTimers();
});

// CAUSE 2: Test order dependency
// BAD: Tests share mutable state
let globalCounter = 0;
test('increment', () => { globalCounter++; expect(globalCounter).toBe(1); });
test('decrement', () => { globalCounter--; expect(globalCounter).toBe(0); });
// Fails if run in different order!

// GOOD: Reset state in beforeEach
beforeEach(() => { globalCounter = 0; });

// CAUSE 3: Async race conditions
// BAD: Not waiting for async operations
test('user is saved', () => {
  saveUser({ name: 'Alice' });  // fire-and-forget
  const user = getUser('Alice');  // might not be saved yet!
  expect(user).toBeDefined();
});

// GOOD: Await properly
test('user is saved', async () => {
  await saveUser({ name: 'Alice' });
  const user = await getUser('Alice');
  expect(user).toBeDefined();
});

// CAUSE 4: Network-dependent tests
// BAD: Calling real external APIs
test('fetch weather', async () => {
  const weather = await fetchWeather('NYC');  // real HTTP call
  expect(weather.temp).toBeDefined();
});

// GOOD: Mock external dependencies
test('fetch weather', async () => {
  nock('https://api.weather.com')
    .get('/v1/current?city=NYC')
    .reply(200, { temp: 72, condition: 'sunny' });

  const weather = await fetchWeather('NYC');
  expect(weather.temp).toBe(72);
});

// CAUSE 5: Port conflicts
// BAD: Hardcoded ports
const server = app.listen(3000);

// GOOD: Dynamic port allocation
const server = app.listen(0); // OS assigns available port
const port = server.address().port;

// CAUSE 6: Database test pollution
// GOOD: Use transactions with rollback
beforeEach(async () => {
  await db.query('BEGIN');
});
afterEach(async () => {
  await db.query('ROLLBACK');
});
```

### Quarantine Strategy

```javascript
// Tag flaky tests
test.skip('known flaky: race condition in event processing', async () => {
  // TODO: Fix race condition in EventProcessor
});

// Or use a dedicated suite
// jest.config.flaky.js
module.exports = {
  ...baseConfig,
  testMatch: ['**/*.flaky.test.{js,ts}'],
};

// CI: Run flaky tests separately with retries
// npm run test:flaky -- --retries=3
```

## Testing Best Practices

### Test Organization

```
# File naming conventions
src/
  user/
    UserService.ts
    UserService.test.ts          # unit tests next to source
    UserService.integration.ts   # integration tests
  __tests__/                     # or in __tests__ directory
    UserService.test.ts

test/                            # or top-level test directory
  unit/
  integration/
  e2e/
  fixtures/
  helpers/
  factories/
```

### Test Naming

```javascript
// Pattern: "should [expected behavior] when [condition]"
describe('calculateShipping', () => {
  it('should return 0 when order total exceeds free shipping threshold', () => {});
  it('should calculate flat rate for domestic orders under threshold', () => {});
  it('should calculate weight-based rate for international orders', () => {});
  it('should throw InvalidAddressError when country is not supported', () => {});
});

// Pattern: "given [context], when [action], then [result]"
describe('UserService.deactivate', () => {
  describe('given an active user with pending orders', () => {
    it('should cancel all pending orders', () => {});
    it('should send a notification email', () => {});
    it('should set status to deactivated', () => {});
  });

  describe('given an already deactivated user', () => {
    it('should throw AlreadyDeactivatedError', () => {});
  });
});
```

### What NOT to Test

```
# Don't test:
# - Framework/library internals (Express routing, React rendering)
# - Simple getters/setters with no logic
# - Private methods directly (test through public interface)
# - Implementation details (HOW it works vs WHAT it produces)
# - Third-party code

# Do test:
# - Business logic and rules
# - Edge cases and boundary conditions
# - Error handling and recovery
# - Integration points (API contracts, DB queries)
# - Security-critical paths (auth, input validation, access control)
```
