import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

/**
 * Replays the real migration history into a throwaway schema, fills it with
 * pre-location data, then applies the locations migration and checks that
 * nothing was lost and every unit of stock landed in a location.
 *
 * A schema rather than a database: dropping a database forces a checkpoint,
 * which takes a minute or more while the rest of the suite is writing.
 */
const MIGRATION = "20260922090000_add_inventory_locations_and_containers";
const migrationsDir = path.resolve(process.cwd(), "prisma/migrations");
const schema = `migration_check_${randomUUID().slice(0, 8)}`;

const ids = {
  salon: randomUUID(),
  branchA: randomUUID(),
  branchB: randomUUID(),
  retail: randomUUID(),
  service: randomUUID(),
  both: randomUUID(),
  neither: randomUUID(),
  sharedRetail: randomUUID(),
  sharedConsumable: randomUUID(),
  empty: randomUUID(),
  negative: randomUUID(),
};

describe("inventory locations migration", () => {
  let client: pg.Client;

  beforeAll(async () => {
    client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
  }, 30_000);

  afterAll(async () => {
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined);
    await client.end().catch(() => undefined);
  }, 30_000);

  it("keeps existing records and books all existing stock into locations", async () => {
    const history = readdirSync(migrationsDir)
      .filter((name) => name < MIGRATION && !name.endsWith(".toml"))
      .sort();
    for (const name of history) {
      await client.query(readFileSync(path.join(migrationsDir, name, "migration.sql"), "utf8"));
    }

    const product = (id: string, name: string, branchId: string | null, stock: number, retail: boolean, consumable: boolean) =>
      `INSERT INTO "Product" ("id","salonId","branchId","name","currentStock","isRetailProduct","isServiceConsumable","updatedAt")
       VALUES ('${id}','${ids.salon}',${branchId ? `'${branchId}'` : "NULL"},'${name}',${stock},${retail},${consumable},NOW());`;
    await client.query(`
      INSERT INTO "Salon" ("id","name","updatedAt") VALUES ('${ids.salon}','Legacy Salon',NOW());
      INSERT INTO "Branch" ("id","name","salonId","updatedAt") VALUES
        ('${ids.branchA}','Main','${ids.salon}',NOW()),
        ('${ids.branchB}','Second','${ids.salon}',NOW());
      ${product(ids.retail, "Retail Serum", ids.branchA, 12.5, true, false)}
      ${product(ids.service, "Bleach", ids.branchA, 40, false, true)}
      ${product(ids.both, "Shampoo", ids.branchB, 99, true, true)}
      ${product(ids.neither, "Towels", ids.branchA, 30, false, false)}
      ${product(ids.sharedRetail, "Shared Wax", null, 8, true, false)}
      ${product(ids.sharedConsumable, "Shared Bleach", null, 6, false, true)}
      ${product(ids.empty, "Empty Oil", ids.branchA, 0, true, false)}
      ${product(ids.negative, "Oversold Mask", ids.branchA, -3, true, false)}
      INSERT INTO "ProductStockMovement" ("id","salonId","branchId","productId","type","quantity","stockBefore","stockAfter","referenceType","referenceId")
      VALUES
        ('${randomUUID()}','${ids.salon}','${ids.branchA}','${ids.retail}','STOCK_IN',12.5,0,12.5,'PRODUCT_PURCHASE','${randomUUID()}'),
        ('${randomUUID()}','${ids.salon}','${ids.branchB}','${ids.both}','RETAIL_SALE',1,100,99,'JOB_CART','${randomUUID()}'),
        ('${randomUUID()}','${ids.salon}',NULL,'${ids.sharedRetail}','STOCK_IN',8,0,8,'PRODUCT_PURCHASE','${randomUUID()}');
    `);
    const snapshot = async () => ({
      products: (await client.query(`SELECT "id","currentStock"::text AS stock,"name" FROM "Product" ORDER BY "id"`)).rows,
      movements: (await client.query(`SELECT "id","type","quantity"::text AS quantity,"stockAfter"::text AS after FROM "ProductStockMovement" ORDER BY "id"`)).rows,
    });
    const before = await snapshot();

    await client.query(readFileSync(path.join(migrationsDir, MIGRATION, "migration.sql"), "utf8"));

    expect(await snapshot()).toEqual(before);
    const balances = (
      await client.query(
        `SELECT "productId","branchId","siteKey","location"::text AS location,"quantity"::text AS quantity FROM "ProductLocationStock"`
      )
    ).rows;
    const at = (productId: string) => balances.filter((row) => row.productId === productId);
    expect(at(ids.retail)).toEqual([expect.objectContaining({ branchId: ids.branchA, siteKey: ids.branchA, location: "RETAIL", quantity: "12.50" })]);
    expect(at(ids.service)).toEqual([expect.objectContaining({ location: "SERVICE", quantity: "40.00" })]);
    expect(at(ids.both)).toEqual([expect.objectContaining({ branchId: ids.branchB, location: "RETAIL", quantity: "99.00" })]);
    expect(at(ids.neither)).toEqual([expect.objectContaining({ location: "WAREHOUSE", quantity: "30.00" })]);
    expect(at(ids.sharedRetail)).toEqual([expect.objectContaining({ branchId: null, siteKey: "SALON", location: "RETAIL", quantity: "8.00" })]);
    expect(at(ids.sharedConsumable)).toEqual([
      expect.objectContaining({ branchId: null, siteKey: "SALON", location: "SERVICE", quantity: "6.00" }),
    ]);
    expect(at(ids.empty)).toEqual([]);
    // Stock that was already negative is carried across as it stands rather
    // than being quietly corrected; it shows up as a balance to reconcile.
    expect(at(ids.negative)).toEqual([expect.objectContaining({ location: "RETAIL", quantity: "-3.00" })]);

    // A product that is both sold and used in services has no historical
    // location. The backfill puts it on the retail shelf, and these are the
    // rows an operator has to check: both flags, one balance, no transfer yet.
    const ambiguous = await client.query(
      `SELECT p."id"
       FROM "Product" p
       JOIN "ProductLocationStock" s ON s."productId" = p."id"
       WHERE p."isRetailProduct" AND p."isServiceConsumable"
       GROUP BY p."id"
       HAVING COUNT(*) = 1`
    );
    expect(ambiguous.rows.map((row) => row.id)).toEqual([ids.both]);

    // No stock disappears: every product total equals its location balances.
    const mismatched = await client.query(
      `SELECT p."id" FROM "Product" p
       LEFT JOIN "ProductLocationStock" s ON s."productId" = p."id"
       GROUP BY p."id", p."currentStock"
       HAVING p."currentStock" <> COALESCE(SUM(s."quantity"), 0)`
    );
    expect(mismatched.rows).toEqual([]);

    // Old movements read as location-less history in the product unit of
    // their time; the new columns are there to use from now on.
    const legacy = await client.query(
      `SELECT COUNT(*)::int AS n FROM "ProductStockMovement" WHERE "location" IS NULL AND "containerId" IS NULL AND "unit" IS NULL`
    );
    expect(legacy.rows[0].n).toBe(3);
    const types = await client.query(
      `SELECT unnest(enum_range(NULL::"${schema}"."ProductStockMovementType"))::text AS type`
    );
    expect(types.rows.map((row) => row.type)).toEqual(
      expect.arrayContaining([
        "TRANSFER",
        "OPEN_CONTAINER",
        "CONTAINER_CLOSED",
        "WASTAGE",
        "LOST",
        "USED_IN_SERVICE",
        "RETAIL_SALE",
      ])
    );
  }, 180_000);
});
