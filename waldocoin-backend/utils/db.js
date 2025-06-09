import { redisClient } from './redisClient.js'

const PROPOSAL_KEY = (id) => `dao:proposal:${id}`
const PROPOSAL_LIST_KEY = 'dao:proposals'

// Create a proposal
export async function createProposal(id, data) {
  const key = PROPOSAL_KEY(id)
  const exists = await redisClient.exists(key)
  if (exists) throw new Error(`Proposal "${id}" already exists.`)

  await redisClient.set(key, JSON.stringify({ ...data, votes: {} }))
  await redisClient.lPush(PROPOSAL_LIST_KEY, id)
}

// Get one proposal
export async function getProposal(id) {
  const data = await redisClient.get(PROPOSAL_KEY(id))
  return data ? JSON.parse(data) : null
}

// Get all proposals
export async function getAllProposals() {
  const ids = await redisClient.lRange(PROPOSAL_LIST_KEY, 0, -1)
  const pipeline = redisClient.multi()
  ids.forEach(id => pipeline.get(PROPOSAL_KEY(id)))
  const results = await pipeline.exec()

  return results.map(([_, val], i) => ({
    id: ids[i],
    ...(val ? JSON.parse(val) : {})
  }))
}

// Cast or update a vote
export async function vote(proposalId, wallet, choice) {
  const key = PROPOSAL_KEY(proposalId)
  const proposal = await getProposal(proposalId)
  if (!proposal) throw new Error(`Proposal "${proposalId}" not found.`)

  proposal.votes[wallet] = choice
  await redisClient.set(key, JSON.stringify(proposal))
}

// Delete a proposal
export async function deleteProposal(id) {
  await redisClient.del(PROPOSAL_KEY(id))
  await redisClient.lRem(PROPOSAL_LIST_KEY, 0, id)
}
