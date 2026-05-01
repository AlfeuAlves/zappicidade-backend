// ============================================================
// ASAAS — Cliente compartilhado para a API de pagamentos
// ============================================================
const ASAAS_URL = process.env.ASAAS_BASE_URL || 'https://sandbox.asaas.com/api/v3'

async function asaas(method, path, body) {
  const res = await fetch(`${ASAAS_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'access_token': process.env.ASAAS_API_KEY,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.errors?.[0]?.description || data?.message || `Asaas ${res.status}`)
  return data
}

async function buscarOuCriarCustomer(comerciante, cpf) {
  const lista = await asaas('GET', `/customers?externalReference=${comerciante.id}&limit=1`)
  if (lista?.data?.length > 0) {
    const c = lista.data[0]
    if (cpf && !c.cpfCnpj) {
      await asaas('PUT', `/customers/${c.id}`, { cpfCnpj: cpf }).catch(() => {})
    }
    return c.id
  }

  const customer = await asaas('POST', '/customers', {
    name:              comerciante.nome_completo || comerciante.email,
    email:             comerciante.email,
    mobilePhone:       comerciante.whatsapp?.replace(/\D/g, '') || undefined,
    cpfCnpj:           cpf || undefined,
    externalReference: comerciante.id,
  })
  return customer.id
}

module.exports = { asaas, buscarOuCriarCustomer }
