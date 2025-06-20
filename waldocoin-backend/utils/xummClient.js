// utils/xummClient.js
import Xumm from 'xumm-sdk'

const xummClient = new Xumm(process.env.XUMM_API_KEY, process.env.XUMM_API_SECRET)

export default xummClient
