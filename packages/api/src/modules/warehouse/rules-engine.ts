import { LocationType } from "@prisma/client";
import { prisma } from "@/db/prisma";
import { NotFoundError } from "@/common/errors";

export interface LocationSuggestion {
  locationId: string;
  fullCode: string;
  type: LocationType;
  occupancyPct: number;
  capacityLeft: number;
  compatible: boolean;
  reason: string;
  recommended: boolean;
}

// Section 7 — Rules Engine: suggests the best storage address for a product
// considering capacity, weight/volume ceiling, category compatibility with
// what already occupies the slot, and current occupancy (favors emptier
// compatible slots to reduce fragmentation before spilling into partially
// compatible ones).
export async function suggestLocations(input: { productId: string; qty: number; preferredType: "PICKING" | "RESERVE" | "CROSS_DOCK" }): Promise<LocationSuggestion[]> {
  const product = await prisma.product.findUnique({ where: { id: input.productId } });
  if (!product) throw new NotFoundError("Produto", input.productId);

  const candidates = await prisma.location.findMany({
    where: { type: input.preferredType, status: "ACTIVE" },
    include: {
      balances: { include: { product: { select: { id: true, sku: true, categoryId: true } } } },
    },
  });

  const scored: LocationSuggestion[] = [];

  for (const loc of candidates) {
    const capacityLeft = loc.capacityQty - loc.occupiedQty;
    if (capacityLeft < input.qty) continue;

    const weightNeeded = input.qty * product.weightKg;
    const volumeNeeded = input.qty * product.volumeM3;
    if (weightNeeded > loc.maxWeightKg || volumeNeeded > loc.maxVolumeM3) continue;

    const occupancyPct = loc.capacityQty > 0 ? Math.round((loc.occupiedQty / loc.capacityQty) * 100) : 0;
    const occupants = new Set(loc.balances.filter((b) => b.qtyPhysical > 0).map((b) => b.productId));
    const allowedCategories = (loc.characteristics as { allowedCategories?: string[] } | null)?.allowedCategories;
    const categoryOk = !allowedCategories || allowedCategories.length === 0 || allowedCategories.includes(product.categoryId);

    let compatible: boolean;
    let reason: string;
    if (occupants.size === 0) {
      compatible = categoryOk;
      reason = categoryOk ? "endereço vazio, categoria compatível" : "endereço vazio, mas categoria restrita não permite este produto";
    } else if (occupants.size === 1 && occupants.has(product.id)) {
      compatible = true;
      reason = "já armazena o mesmo produto";
    } else {
      compatible = false;
      reason = "endereço ocupado por outro produto";
    }

    if (!compatible && !categoryOk) continue; // hard rule: never suggest a category-restricted slot
    if (!compatible && occupants.size > 0 && !occupants.has(product.id)) {
      // still surface as "partially compatible" only when capacity clearly allows coexistence
      reason = "compatível parcialmente — endereço já ocupado por outro produto";
    }

    scored.push({
      locationId: loc.id,
      fullCode: loc.fullCode,
      type: loc.type,
      occupancyPct,
      capacityLeft,
      compatible: compatible || (categoryOk && occupants.size > 0),
      reason,
      recommended: false,
    });
  }

  scored.sort((a, b) => {
    if (a.compatible !== b.compatible) return a.compatible ? -1 : 1;
    return a.occupancyPct - b.occupancyPct;
  });

  const top = scored.slice(0, 5);
  if (top.length > 0) top[0].recommended = true;
  return top;
}
