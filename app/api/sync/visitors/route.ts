// Profile views endpoint not available on current Unipile plan
export async function POST() {
  return Response.json({
    synced: 0,
    errors: [],
    total: 0,
    message: 'Fonctionnalité non disponible sur ce plan Unipile',
  })
}
