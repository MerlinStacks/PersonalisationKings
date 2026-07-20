"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

interface MappingItem {
  id: string;
  storeUrl: string;
  externalProductId: string;
  externalVariantId: string | null;
  designId: string;
  priceModifierMinor: number;
  active: boolean;
}

interface StoreOption {
  id: string;
  url: string;
  status: string;
}

interface DesignOption {
  id: string;
  name: string;
  version: number;
}

export function ProductMappingManager({ mappings, stores, designs }: Readonly<{
  mappings: MappingItem[];
  stores: StoreOption[];
  designs: DesignOption[];
}>) {
  const router = useRouter();
  const [storeId, setStoreId] = useState(stores[0]?.id ?? "");
  const [productId, setProductId] = useState("");
  const [variantId, setVariantId] = useState("");
  const [designId, setDesignId] = useState(designs[0]?.id ?? "");
  const [priceModifierMinor, setPriceModifierMinor] = useState(0);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function createMapping(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setIsCreating(true);
    try {
      const response = await fetch("/api/product-mappings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId,
          externalProductId: productId.trim(),
          ...(variantId.trim() ? { externalVariantId: variantId.trim() } : {}),
          designId,
          priceModifierMinor,
          active: true
        })
      });
      const body = await response.json().catch(() => null) as { message?: string } | null;
      if (!response.ok) throw new Error(body?.message ?? "The product mapping could not be created");
      setProductId("");
      setVariantId("");
      setMessage("Product mapping created.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The product mapping could not be created");
    } finally {
      setIsCreating(false);
    }
  }

  const canCreate = Boolean(storeId && designId && productId.trim());

  return (
    <div className="mapping-manager">
      <section className="mapping-create" aria-labelledby="new-mapping-heading">
        <div>
          <p className="eyebrow">Assignment</p>
          <h2 id="new-mapping-heading">Map a WooCommerce product</h2>
          <p>Leave variant ID blank to use this design as the fallback for every unmapped variation.</p>
        </div>
        <form onSubmit={createMapping}>
          <label>Store
            <select required value={storeId} onChange={(event) => setStoreId(event.target.value)}>
              <option value="">Select a store</option>
              {stores.map((store) => <option key={store.id} value={store.id}>{store.url} ({store.status})</option>)}
            </select>
          </label>
          <label>WooCommerce product ID
            <input required maxLength={190} value={productId} onChange={(event) => setProductId(event.target.value)} inputMode="numeric" />
          </label>
          <label>Variation ID <span>Optional</span>
            <input maxLength={190} value={variantId} onChange={(event) => setVariantId(event.target.value)} inputMode="numeric" />
          </label>
          <label>Published design
            <select required value={designId} onChange={(event) => setDesignId(event.target.value)}>
              <option value="">Select a design</option>
              {designs.map((design) => <option key={design.id} value={design.id}>{design.name} (v{design.version})</option>)}
            </select>
          </label>
          <label>Price change <span>Minor units</span>
            <input type="number" step="1" min="-10000000" max="10000000" value={priceModifierMinor} onChange={(event) => setPriceModifierMinor(Number(event.target.value))} />
          </label>
          <button type="submit" disabled={!canCreate || isCreating}>{isCreating ? "Creating..." : "Create mapping"}</button>
        </form>
        {stores.length === 0 ? <p className="error-box">Connect a store before creating mappings.</p> : null}
        {designs.length === 0 ? <p className="error-box">Publish a design before creating mappings.</p> : null}
        {error ? <p className="error-box" role="alert">{error}</p> : null}
        {message ? <p className="success-box" role="status">{message}</p> : null}
      </section>

      <section className="mapping-list" aria-labelledby="existing-mappings-heading">
        <div className="mapping-list-heading">
          <div>
            <p className="eyebrow">Current assignments</p>
            <h2 id="existing-mappings-heading">{mappings.length} mapping{mappings.length === 1 ? "" : "s"}</h2>
          </div>
          <p>Specific variation mappings override the all-variants fallback.</p>
        </div>
        {mappings.length === 0 ? <p className="empty-state">No product mappings exist yet.</p> : null}
        <div className="mapping-rows">
          {mappings.map((mapping) => <MappingRow key={mapping.id} mapping={mapping} designs={designs} onSaved={() => router.refresh()} />)}
        </div>
      </section>
    </div>
  );
}

function MappingRow({ mapping, designs, onSaved }: Readonly<{
  mapping: MappingItem;
  designs: DesignOption[];
  onSaved: () => void;
}>) {
  const [designId, setDesignId] = useState(mapping.designId);
  const [active, setActive] = useState(mapping.active);
  const [priceModifierMinor, setPriceModifierMinor] = useState(mapping.priceModifierMinor);
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function save() {
    setIsSaving(true);
    setStatus(null);
    try {
      const response = await fetch(`/api/product-mappings/${encodeURIComponent(mapping.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ designId, priceModifierMinor, active })
      });
      const body = await response.json().catch(() => null) as { message?: string } | null;
      if (!response.ok) throw new Error(body?.message ?? "Unable to update mapping");
      setStatus("Saved");
      onSaved();
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : "Unable to update mapping");
    } finally {
      setIsSaving(false);
    }
  }

  const changed = designId !== mapping.designId || priceModifierMinor !== mapping.priceModifierMinor || active !== mapping.active;

  return (
    <article className={active ? "mapping-row" : "mapping-row inactive"}>
      <div className="mapping-identity">
        <strong>Product {mapping.externalProductId}</strong>
        <span>{mapping.externalVariantId ? `Variation ${mapping.externalVariantId}` : "All variants"}</span>
        <small>{mapping.storeUrl}</small>
      </div>
      <label>Design
        <select value={designId} onChange={(event) => setDesignId(event.target.value)}>
          {designs.map((design) => <option key={design.id} value={design.id}>{design.name} (v{design.version})</option>)}
        </select>
      </label>
      <label>Price change <span>Minor units</span>
        <input type="number" step="1" min="-10000000" max="10000000" value={priceModifierMinor} onChange={(event) => setPriceModifierMinor(Number(event.target.value))} />
      </label>
      <label className="mapping-toggle"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} /> Active</label>
      <button type="button" disabled={!changed || isSaving} onClick={() => void save()}>{isSaving ? "Saving..." : "Save"}</button>
      {status ? <span className="mapping-status" role="status">{status}</span> : null}
    </article>
  );
}
