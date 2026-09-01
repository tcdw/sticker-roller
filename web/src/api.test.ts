import { afterEach, describe, expect, mock, test } from "bun:test";
import { referencedIdsFromPrompt, saveAsset } from "./api";
import type { AssetRow } from "../../src/web-types";
const body = { name: "demo", prompt: "a loud sticker" };
afterEach(() => mock.restore());
describe("saveAsset", () => {
  test("creates a new asset when no asset is selected", async () => { const fetchMock = mock(() => Promise.resolve(Response.json({ id: "asset-1", ...body }))); globalThis.fetch = fetchMock as unknown as typeof fetch; await saveAsset(undefined, body); expect(fetchMock).toHaveBeenCalledWith("/api/assets", expect.objectContaining({ method: "POST" })); });
  test("updates the selected asset with PATCH instead of creating a duplicate", async () => { const fetchMock = mock(() => Promise.resolve(Response.json({ id: "asset-1", ...body }))); globalThis.fetch = fetchMock as unknown as typeof fetch; await saveAsset("asset-1", body); expect(fetchMock).toHaveBeenCalledWith("/api/assets/asset-1", expect.objectContaining({ method: "PATCH" })); });
});
describe("prompt asset references", () => {
  const assets = [{ id: "a1", name: "同名", prompt: "one" }, { id: "a2", name: "同名", prompt: "two" }] as AssetRow[];
  test("uses stable IDs and removes deleted tokens", () => { expect(referencedIdsFromPrompt("@[同名](asset:a2) prose", assets)).toEqual(["a2"]); expect(referencedIdsFromPrompt("同名 prose", assets)).toEqual([]); });
});
