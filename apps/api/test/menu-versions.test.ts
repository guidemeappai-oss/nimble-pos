import { afterAll, expect, it } from "vitest";
import { freshDb } from "./helpers/db";
import { authedApp, makeUser } from "./helpers/actors";
const { db, close } = await freshDb();
const { app, tokenFor } = authedApp(db);
afterAll(async () => {
  await app.close();
  await close();
});
it("saves a private draft, publishes atomically, restores as a new version and rejects stale edits", async () => {
  const token = await tokenFor(await makeUser(db, "NQ-menu-owner-1234"));
  const headers = {
    authorization: `Bearer ${token}`
  };
  const venue = (await app.inject({
    method: "POST", url: "/v1/merchant/venues", headers, payload: {
      name: "Menu", fiatCurrency: "EUR", nimAddress: "NQ-menu-owner-1234"
    }
  })).json();
  const base = `/v1/merchant/venues/${venue.id}`;
  const product = {
    id: crypto.randomUUID(), name: "Coffee", category: "Drinks", available: true, variants: [{
        id: crypto.randomUUID(), name: "Large", priceMinor: 450
      }], extras: []
  };
  const call = (method: any, path: string, payload?: any) => app.inject({
    method, url: base + path, headers, payload
  });
  expect((await call("GET", "/menu")).json()).toMatchObject({
    publishedRevision: 0, products: [], draft: null
  });
  const saved = await call("PUT", "/menu/draft", {
    idempotencyKey: crypto.randomUUID(), revision: null, basePublishedRevision: 0, products: [product], reason: "New menu"
  });
  expect(saved.statusCode).toBe(200);
  expect((await call("GET", "/catalog")).json()).toEqual([]);
  const input = {
    draftRevision: saved.json().draft.revision, basePublishedRevision: 0, idempotencyKey: crypto.randomUUID(), reason: "Launch"
  };
  expect((await call("POST", "/menu/publish", input)).json()).toMatchObject({
    publishedRevision: 1, draft: null, products: [product]
  });
  expect((await call("POST", "/menu/publish", input)).statusCode).toBe(200);
  expect((await call("PUT", "/menu/draft", {
    idempotencyKey: crypto.randomUUID(), revision: null, basePublishedRevision: 0, products: [], reason: "Stale"
  })).statusCode).toBe(409);
  const history = (await call("GET", "/menu/versions")).json();
  expect(history.versions).toHaveLength(1);
  const restored = (await call("POST", `/menu/versions/${history.versions[0].id}/restore`, {
    idempotencyKey: crypto.randomUUID(), draftRevision: null, basePublishedRevision: 1, reason: "Restore"
  })).json();
  expect(restored.draft.products).toEqual([product]);
  expect(restored.draft.revision).toBeGreaterThan(input.draftRevision);
  expect((await call("POST", "/menu/publish", {
    draftRevision: restored.draft.revision, basePublishedRevision: 1, idempotencyKey: crypto.randomUUID(), reason: "Republish"
  })).statusCode).toBe(200);
  expect((await call("GET", "/menu/versions")).json().versions.map((v: any) => v.revision)).toEqual([2, 1]);
});
it("rejects stale drafts after live availability, duplicate identities and foreign products without changing live menu", async () => {
  const owner = await tokenFor(await makeUser(db, "NQ-menu-owner-two"));
  const headers = {
    authorization: `Bearer ${owner}`
  };
  const create = async (name: string) => (await app.inject({
    method: "POST", url: "/v1/merchant/venues", headers, payload: {
      name, fiatCurrency: "EUR", nimAddress: "NQ-menu-owner-two"
    }
  })).json();
  const a = await create("A"), b = await create("B");
  const base = `/v1/merchant/venues/${a.id}`;
  const call = (method: any, path: string, payload?: any) => app.inject({
    method, url: base + path, headers, payload
  });
  const product = (await call("POST", "/catalog", {
    name: "Tea", category: "Tea", variants: [{
        id: crypto.randomUUID(), name: "One", priceMinor: 100
      }], extras: []
  })).json();
  const saved = (await call("PUT", "/menu/draft", {
    idempotencyKey: crypto.randomUUID(), revision: null, basePublishedRevision: 1, products: [{
        ...product, name: "Draft Tea"
      }], reason: "Edit"
  })).json();
  expect((await call("PATCH", `/catalog/${product.id}/availability`, {
    available: false
  })).statusCode).toBe(200);
  expect((await call("POST", "/menu/publish", {
    draftRevision: saved.draft.revision, basePublishedRevision: 1, idempotencyKey: crypto.randomUUID(), reason: "Stale"
  })).statusCode).toBe(409);
  expect((await call("GET", "/catalog")).json()[0]).toMatchObject({
    name: "Tea", available: false
  });
  const workspace = (await call("GET", "/menu")).json();
  expect((await call("POST", "/menu/publish", {
    draftRevision: workspace.draft.revision, basePublishedRevision: workspace.publishedRevision, idempotencyKey: crypto.randomUUID(), reason: "Refreshed but unreconciled"
  })).statusCode).toBe(409);
  expect((await call("PUT", "/menu/draft", {
    idempotencyKey: crypto.randomUUID(), revision: workspace.draft.revision, basePublishedRevision: 2, products: [product, product], reason: "Duplicate"
  })).statusCode).toBe(400);
  const foreign = await app.inject({
    method: "PUT", url: `/v1/merchant/venues/${b.id}/menu/draft`, headers, payload: {
      idempotencyKey: crypto.randomUUID(), revision: null, basePublishedRevision: 0, products: [product], reason: "Foreign"
    }
  });
  expect(foreign.statusCode).toBe(404);
  const otherToken = await tokenFor(await makeUser(db, "NQ-other-menu-123"));
  expect((await app.inject({
    url: base + "/menu", headers: {
      authorization: `Bearer ${otherToken}`
    }
  })).statusCode).toBe(404);
});
it("cashiers cannot inspect drafts; delegated manager access is revoked live", async () => {
  const owner = await tokenFor(await makeUser(db, "NQ-menu-access-owner"));
  const headers = {
    authorization: `Bearer ${owner}`
  };
  const venue = (await app.inject({
    method: "POST", url: "/v1/merchant/venues", headers, payload: {
      name: "Access", fiatCurrency: "EUR", nimAddress: "NQ-menu-access-owner"
    }
  })).json();
  const base = `/v1/merchant/venues/${venue.id}`;
  const employee = (await app.inject({
    method: "POST", url: base + "/employees", headers, payload: {
      name: "Ana", pin: "1234"
    }
  })).json();
  const paired = (await app.inject({
    method: "POST", url: base + "/terminal", headers
  })).json();
  const login = (await app.inject({
    method: "POST", url: "/v1/merchant/terminal/login", headers: {
      "x-terminal-token": paired.terminalToken
    }, payload: {
      employeeId: employee.id, pin: "1234"
    }
  })).json();
  const employeeHeaders = {
    authorization: `Bearer ${login.token}`
  };
  expect((await app.inject({
    url: base + "/menu", headers: employeeHeaders
  })).statusCode).toBe(403);
  expect((await app.inject({
    method: "PATCH", url: `/v1/merchant/employees/${employee.id}`, headers, payload: {
      role: "MANAGER", permissions: ["menu.manage"], reason: "Delegate"
    }
  })).statusCode).toBe(200);
  expect((await app.inject({
    url: base + "/menu", headers: employeeHeaders
  })).statusCode).toBe(200);
  expect((await app.inject({
    method: "PATCH", url: `/v1/merchant/employees/${employee.id}`, headers, payload: {
      role: "MANAGER", permissions: [], reason: "Revoke"
    }
  })).statusCode).toBe(200);
  expect((await app.inject({
    url: base + "/menu/versions", headers: employeeHeaders
  })).statusCode).toBe(403);
});
it("concurrent venues cannot claim and overwrite one shared product identity", async () => {
  const token = await tokenFor(await makeUser(db, "NQ-menu-concurrent-owner"));
  const headers = {
    authorization: `Bearer ${token}`
  };
  const make = async (name: string) => (await app.inject({
    method: "POST", url: "/v1/merchant/venues", headers, payload: {
      name, fiatCurrency: "EUR", nimAddress: "NQ-menu-concurrent-owner"
    }
  })).json();
  const venues = await Promise.all([make("First"), make("Second")]);
  const product = {
    id: crypto.randomUUID(), name: "Original", category: "Food", variants: [{
        id: crypto.randomUUID(), name: "One", priceMinor: 50
      }], extras: []
  };
  const result = await Promise.all(venues.map((v, i) => app.inject({
    method: "POST", url: `/v1/merchant/venues/${v.id}/catalog`, headers, payload: {
      ...product, name: i ? "Second" : "First"
    }
  })));
  expect(result.map(r => r.statusCode).sort()).toEqual([201, 404]);
  const catalogs = await Promise.all(venues.map(v => app.inject({
    url: `/v1/merchant/venues/${v.id}/catalog`, headers
  })));
  expect(catalogs.reduce((n, r) => n + r.json().length, 0)).toBe(1);
  const winner = result.findIndex(r => r.statusCode === 201);
  expect(catalogs[winner].json()[0].name).toBe(winner ? "Second" : "First");
});
it("opening an empty workspace does not lock currency and draft retries return one revision", async () => {
  const token = await tokenFor(await makeUser(db, "NQ-menu-empty-owner"));
  const headers = {
    authorization: `Bearer ${token}`
  };
  const venue = (await app.inject({
    method: "POST", url: "/v1/merchant/venues", headers, payload: {
      name: "Empty", fiatCurrency: "EUR", nimAddress: "NQ-menu-empty-owner"
    }
  })).json();
  const base = `/v1/merchant/venues/${venue.id}`;
  expect((await app.inject({
    url: base + "/menu", headers
  })).statusCode).toBe(200);
  expect((await app.inject({
    method: "PATCH", url: base, headers, payload: {
      name: "Empty", fiatCurrency: "PLN", nimAddress: venue.nimAddress
    }
  })).statusCode).toBe(200);
  const payload = {
    revision: null, basePublishedRevision: 0, products: [], reason: "Empty draft", idempotencyKey: crypto.randomUUID()
  };
  const saved = await app.inject({
    method: "PUT", url: base + "/menu/draft", headers, payload
  });
  expect(saved.statusCode).toBe(200);
  expect((await app.inject({
    method: "PUT", url: base + "/menu/draft", headers, payload
  })).json()).toEqual(saved.json());
  expect((await app.inject({
    method: "PUT", url: base + "/menu/draft", headers, payload: {
      ...payload, reason: "Different intent"
    }
  })).statusCode).toBe(409);
  expect((await app.inject({
    method: "PATCH", url: base, headers, payload: {
      name: "Empty", fiatCurrency: "EUR", nimAddress: venue.nimAddress
    }
  })).statusCode).toBe(409);
});
