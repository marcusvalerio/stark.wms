export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface AuthUser {
  id: string;
  matricula: string;
  name: string;
  email: string;
  roleCode: string;
  permissions: string[];
  authorizedZones: string[];
}

export interface Category { id: string; code: string; name: string; description?: string | null; status: string; }
export interface UnitOfMeasure { id: string; code: string; name: string; isBase: boolean; }

export interface Product {
  id: string; sku: string; internalCode: string; barcode?: string | null; description: string;
  categoryId: string; category?: Category; baseUomId: string; baseUom?: UnitOfMeasure;
  weightKg: number; lengthCm: number; widthCm: number; heightCm: number; volumeM3: number;
  type: string; lotControl: boolean; expiryControl: boolean; serialControl: boolean;
  minStock: number; maxStock: number; status: string;
}

export interface Supplier { id: string; code: string; legalName: string; cnpj: string; status: string; contacts?: unknown; address?: unknown; }
export interface Customer { id: string; code: string; name: string; document: string; status: string; }
export interface Carrier { id: string; code: string; name: string; document: string; status: string; }

export interface Warehouse { id: string; code: string; name: string; status: string; zones?: Zone[]; docks?: Dock[]; }
export interface Zone { id: string; warehouseId: string; code: string; name: string; type: string; status: string; _count?: { locations: number }; }
export interface Location {
  id: string; zoneId: string; zone?: Zone; aisle: string; rack: string; level: string; position: string;
  fullCode: string; type: string; status: string; capacityQty: number; occupiedQty: number;
  maxWeightKg: number; maxVolumeM3: number; pickingMin?: number | null; pickingMax?: number | null;
}
export interface Dock { id: string; warehouseId: string; code: string; type: string; status: string; }

export interface Lot { id: string; code: string; expiryDate?: string | null; status: string; }
export interface InventoryBalance {
  id: string; productId: string; product?: { sku: string; description: string; minStock: number; maxStock: number };
  locationId: string; location?: { fullCode: string; type: string };
  lotId?: string | null; lot?: Lot | null;
  qtyPhysical: number; qtyAvailable: number; qtyReserved: number; qtyBlocked: number; qtyQuarantine: number; updatedAt: string;
}
export interface Movement {
  id: string; type: string; qty: number; createdAt: string; reason?: string | null;
  product?: { sku: string; description: string }; lot?: { code: string } | null;
  fromLocation?: { fullCode: string } | null; toLocation?: { fullCode: string } | null;
  user?: { name: string; matricula: string };
}

export interface ReceiptItem {
  id: string; receiptId: string; productId: string; product?: { sku: string; description: string; lotControl: boolean; expiryControl: boolean };
  expectedQty: number; receivedQty: number; damagedQty: number; status: string; lotId?: string | null; lot?: Lot | null;
}
export interface Receipt {
  id: string; number: string; supplierId: string; supplier?: Supplier; scheduledDate: string; arrivalDate?: string | null;
  dockId?: string | null; dock?: Dock | null; status: string; crossDock: boolean; operatorId?: string | null;
  operator?: { id: string; name: string } | null; notes?: string | null; items: ReceiptItem[];
}

export interface Discrepancy {
  id: string; type: string; status: string; refType: string; refId: string; productId?: string | null;
  product?: { sku: string; description: string } | null; expectedQty?: number | null; actualQty?: number | null;
  description: string; createdBy?: { name: string }; resolvedBy?: { name: string } | null; resolvedAt?: string | null;
  resolutionAction?: string | null; resolutionNotes?: string | null; createdAt: string;
}

export interface OrderItem {
  id: string; orderId: string; productId: string; product?: { sku: string; description: string; expiryControl: boolean; lotControl: boolean };
  uomId: string; qtyOrdered: number; qtyAllocated: number; qtyPicked: number; qtyShipped: number;
}
export interface Order {
  id: string; number: string; customerId: string; customer?: Customer; orderDate: string; priority: string;
  slaDueAt?: string | null; status: string; carrierId?: string | null; carrier?: Carrier | null; notes?: string | null; items: OrderItem[];
}

export interface PickingTask {
  id: string; waveId?: string | null; orderItemId: string; orderItem?: { order?: { number: string; priority: string } };
  productId: string; product?: { sku: string; description: string; barcode?: string | null };
  lotId?: string | null; locationId: string; location?: { fullCode: string };
  qtySuggested: number; qtyPicked: number; sequence: number; strategy: string; operatorId?: string | null; status: string;
}

export interface Task {
  id: string; type: string; priority: string; status: string; refType: string; refId: string;
  originLocationId?: string | null; originLocation?: { fullCode: string } | null;
  destLocationId?: string | null; destLocation?: { fullCode: string } | null;
  productId?: string | null; product?: { sku: string; description: string } | null; qty?: number | null;
  assignedToId?: string | null; assignedTo?: { id: string; name: string; matricula: string } | null;
  slaDueAt?: string | null; createdAt: string; startedAt?: string | null; completedAt?: string | null;
}

export interface PickWave {
  id: string; code: string; status: string; createdAt: string; releasedAt?: string | null; completedAt?: string | null;
  orders?: { order: { id: string; number: string; status: string; priority: string; customer: { name: string } } }[];
  pickingTasks?: PickingTask[];
}

export interface ReplenishmentTask {
  id: string; productId: string; product?: { sku: string; description: string };
  fromLocationId: string; fromLocation?: { fullCode: string }; toLocationId: string; toLocation?: { fullCode: string };
  qty: number; status: string; operatorId?: string | null; createdAt: string;
}

export interface InventoryCountItem {
  id: string; countId: string; locationId: string; location?: { fullCode: string }; productId: string;
  product?: { sku: string; description: string }; lotId?: string | null; lot?: { code: string } | null;
  systemQty: number; countedQty1?: number | null; countedQty2?: number | null; finalQty?: number | null; status: string;
}
export interface InventoryCount { id: string; code: string; type: string; status: string; createdAt: string; closedAt?: string | null; items?: InventoryCountItem[]; }

export interface QualityInspection {
  id: string; refType: string; refId: string; productId: string; product?: { sku: string; description: string };
  lotId?: string | null; lot?: { code: string } | null; locationId?: string | null; location?: { fullCode: string } | null;
  qty?: number | null; status: string; result?: string | null; inspector?: { name: string } | null; notes?: string | null; createdAt: string;
}

export interface Package { id: string; orderId: string; code: string; status: string; weightKg?: number | null; items: { id: string; orderItemId: string; qty: number; orderItem?: { product?: { sku: string; description: string } } }[]; }
export interface Shipment {
  id: string; orderId: string; order?: Order; romaneioNumber: string; carrierId: string; carrier?: Carrier;
  dockId?: string | null; dock?: Dock | null; status: string; loadedAt?: string | null; shippedAt?: string | null; createdAt: string;
  packages?: { package: Package }[];
}

export interface User {
  id: string; matricula: string; name: string; email: string; role: string; roleName?: string; shift?: string | null;
  status: string; operatorStatus: string; authorizedZones: string[]; createdAt?: string;
}

export interface AuditLog {
  id: string; userId?: string | null; user?: { name: string; matricula: string } | null; action: string;
  entityType: string; entityId: string; previousValue?: unknown; newValue?: unknown; createdAt: string;
}

export interface DashboardSnapshot {
  receiving: Record<string, number>;
  orders: Record<string, number>;
  tasks: { type: string; status: string; count: number }[];
  discrepanciesOpen: number;
  countsInProgress: number;
  shipmentsToday: number;
  warehouseOccupancyPct: number;
  productsBelowMinimum: number;
  generatedAt: string;
}

export interface ControlTower {
  delayedTasks: { id: string; type: string; priority: string; slaDueAt: string | null; assignedTo: string | null; product: string | null }[];
  occupiedDocks: { dockId: string; code: string; type: string; receipts: string[]; shipments: string[] }[];
  criticalOrders: { id: string; number: string; priority: string; status: string; slaDueAt: string | null; customer: string }[];
  operators: { id: string; name: string; status: string; shift: string | null; activeTasks: number }[];
  pendingTasksByType: { type: string; count: number }[];
  alerts: { level: string; message: string }[];
  generatedAt: string;
}
