import { getDB, type DeviceSnapshot } from "./db";

export async function listSnapshots(deviceId?: string): Promise<DeviceSnapshot[]> {
  const db = await getDB();
  if (deviceId) return db.getAllFromIndex("deviceHistory", "deviceId", deviceId);
  return db.getAll("deviceHistory");
}

export async function putSnapshot(snap: DeviceSnapshot): Promise<void> {
  const db = await getDB();
  await db.put("deviceHistory", snap);
}

export async function putSnapshots(snaps: DeviceSnapshot[]): Promise<void> {
  if (snaps.length === 0) return;
  const db = await getDB();
  const tx = db.transaction("deviceHistory", "readwrite");
  for (const s of snaps) await tx.store.put(s);
  await tx.done;
}

export async function deleteSnapshot(id: string): Promise<void> {
  const db = await getDB();
  await db.delete("deviceHistory", id);
}

export async function clearDeviceHistory(deviceId: string): Promise<void> {
  const db = await getDB();
  const all = await db.getAllFromIndex("deviceHistory", "deviceId", deviceId);
  const tx = db.transaction("deviceHistory", "readwrite");
  for (const s of all) await tx.store.delete(s.id);
  await tx.done;
}