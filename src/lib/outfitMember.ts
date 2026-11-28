// Which garment of an outfit owns a cloth vertex or a piece. Pure: the outfit simulation lays the garments out one after
// another (particles start..start+count per garment, see OutfitGarment in src/sim/outfit.ts), so a vertex index decides.

export interface MemberRange { projectId: string; start: number; count: number }

/** The project id of the garment whose particle range holds vertex v; undefined when there is no outfit or v is outside. */
export function memberOfVertex(members: MemberRange[] | undefined, v: number): string | undefined {
  if (!members) return undefined;
  for (const m of members) if (v >= m.start && v < m.start + m.count) return m.projectId;
  return undefined;
}

/** The project whose pieces (or attachments) include this id; piece ids are unique across the projects of an outfit. */
export function memberOfPiece(pieceId: string, owners: { projectId: string; ids: string[] }[]): string | undefined {
  return owners.find((o) => o.ids.includes(pieceId))?.projectId;
}
