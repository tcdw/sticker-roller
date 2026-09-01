import { afterEach, describe, expect, mock, test } from "bun:test";
import { saveAsset } from "./api";

const body = { name: "demo", prompt: "a loud sticker" };

afterEach(() => mock.restore());

describe("saveAsset", () => {
  test("creates a new asset when no asset is selected", async () => {
    const fetchMock = mock(() => Promise.resolve(Response.json({ id: "asset-1", ...body })));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await saveAsset(undefined, body);

    expect(fetchMock).toHaveBeenCalledWith("/api/assets", expect.objectContaining({ method: "POST" }));
  });

  test("updates the selected asset with PATCH instead of creating a duplicate", async () => {
    const fetchMock = mock(() => Promise.resolve(Response.json({ id: "asset-1", ...body })));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await saveAsset("asset-1", body);

    expect(fetchMock).toHaveBeenCalledWith("/api/assets/asset-1", expect.objectContaining({ method: "PATCH" }));
  });
});
