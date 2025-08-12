// ⚡ SOLANA WALLET OPERATIONS

import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAccount
} from '@solana/spl-token';
import { validateWalletAddress } from '../../../shared/utils/validation.js';
import { SUPPORTED_CHAINS, ERROR_CODES } from '../../../shared/types/index.js';

export class SolanaWallet {
  constructor(config) {
    this.connection = new Connection(config.rpcUrl, 'confirmed');
    this.distributorSecret = config.distributorSecret;
    this.distributorKeypair = null;
    this.waldoMint = new PublicKey(config.waldoMint);
    
    if (this.distributorSecret) {
      // Convert base58 private key to Keypair
      const secretKey = Uint8Array.from(JSON.parse(this.distributorSecret));
      this.distributorKeypair = Keypair.fromSecretKey(secretKey);
      console.log(`🔑 Solana distributor wallet loaded: ${this.distributorKeypair.publicKey.toString()}`);
    }
  }

  /**
   * Test connection to Solana network
   */
  async connect() {
    try {
      const version = await this.connection.getVersion();
      console.log(`✅ Connected to Solana network (version: ${version['solana-core']})`);
      return { success: true };
    } catch (error) {
      console.error('❌ Solana connection failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Validate Solana wallet address
   */
  validateAddress(address) {
    return validateWalletAddress(address, SUPPORTED_CHAINS.SOLANA);
  }

  /**
   * Get wallet balance (SOL and WALDO)
   */
  async getBalance(address) {
    try {
      const validation = this.validateAddress(address);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }

      const publicKey = new PublicKey(address);

      // Get SOL balance
      const solBalance = await this.connection.getBalance(publicKey);
      const solAmount = solBalance / LAMPORTS_PER_SOL;

      // Get WALDO balance
      let waldoBalance = 0;
      try {
        const associatedTokenAddress = await getAssociatedTokenAddress(
          this.waldoMint,
          publicKey
        );

        const tokenAccount = await getAccount(
          this.connection,
          associatedTokenAddress
        );

        waldoBalance = Number(tokenAccount.amount) / Math.pow(10, 9); // Assuming 9 decimals
      } catch (error) {
        // Token account doesn't exist or other error
        console.warn('⚠️ Could not fetch WALDO balance:', error.message);
      }

      return {
        success: true,
        data: {
          address,
          sol: solAmount,
          waldo: waldoBalance,
          chain: SUPPORTED_CHAINS.SOLANA
        }
      };
    } catch (error) {
      console.error('❌ Failed to get Solana balance:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Check if wallet has WALDO token account
   */
  async hasTokenAccount(address) {
    try {
      const validation = this.validateAddress(address);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }

      const publicKey = new PublicKey(address);
      const associatedTokenAddress = await getAssociatedTokenAddress(
        this.waldoMint,
        publicKey
      );

      try {
        await getAccount(this.connection, associatedTokenAddress);
        return {
          success: true,
          data: { hasTokenAccount: true, address, tokenAddress: associatedTokenAddress.toString() }
        };
      } catch (error) {
        return {
          success: true,
          data: { hasTokenAccount: false, address, tokenAddress: associatedTokenAddress.toString() }
        };
      }
    } catch (error) {
      console.error('❌ Failed to check token account:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send WALDO tokens
   */
  async sendWaldo(toAddress, amount) {
    try {
      if (!this.distributorKeypair) {
        return { success: false, error: 'Distributor wallet not configured' };
      }

      const validation = this.validateAddress(toAddress);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }

      const toPublicKey = new PublicKey(toAddress);
      const fromPublicKey = this.distributorKeypair.publicKey;

      // Get associated token addresses
      const fromTokenAddress = await getAssociatedTokenAddress(
        this.waldoMint,
        fromPublicKey
      );

      const toTokenAddress = await getAssociatedTokenAddress(
        this.waldoMint,
        toPublicKey
      );

      const transaction = new Transaction();

      // Check if recipient token account exists, create if not
      try {
        await getAccount(this.connection, toTokenAddress);
      } catch (error) {
        // Token account doesn't exist, create it
        transaction.add(
          createAssociatedTokenAccountInstruction(
            fromPublicKey, // payer
            toTokenAddress, // associated token account
            toPublicKey, // owner
            this.waldoMint // mint
          )
        );
      }

      // Add transfer instruction
      const transferAmount = Math.floor(amount * Math.pow(10, 9)); // Convert to smallest unit
      transaction.add(
        createTransferInstruction(
          fromTokenAddress, // source
          toTokenAddress, // destination
          fromPublicKey, // owner
          transferAmount // amount
        )
      );

      // Get recent blockhash
      const { blockhash } = await this.connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = fromPublicKey;

      // Sign and send transaction
      transaction.sign(this.distributorKeypair);
      const signature = await this.connection.sendRawTransaction(transaction.serialize());

      // Confirm transaction
      await this.connection.confirmTransaction(signature, 'confirmed');

      return {
        success: true,
        data: {
          signature,
          amount: amount,
          to: toAddress,
          chain: SUPPORTED_CHAINS.SOLANA
        }
      };
    } catch (error) {
      console.error('❌ Failed to send WALDO:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get recent transactions for address
   */
  async getRecentTransactions(address, limit = 20) {
    try {
      const validation = this.validateAddress(address);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }

      const publicKey = new PublicKey(address);
      const signatures = await this.connection.getSignaturesForAddress(
        publicKey,
        { limit }
      );

      const transactions = [];
      for (const sigInfo of signatures) {
        try {
          const tx = await this.connection.getTransaction(sigInfo.signature, {
            maxSupportedTransactionVersion: 0
          });

          if (tx) {
            transactions.push({
              signature: sigInfo.signature,
              slot: sigInfo.slot,
              blockTime: sigInfo.blockTime,
              success: sigInfo.err === null,
              fee: tx.meta?.fee || 0
            });
          }
        } catch (error) {
          console.warn(`⚠️ Could not fetch transaction ${sigInfo.signature}:`, error.message);
        }
      }

      return {
        success: true,
        data: {
          address,
          transactions,
          chain: SUPPORTED_CHAINS.SOLANA
        }
      };
    } catch (error) {
      console.error('❌ Failed to get transactions:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Monitor account for changes
   */
  async subscribeToAccount(address, callback) {
    try {
      const validation = this.validateAddress(address);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }

      const publicKey = new PublicKey(address);
      
      const subscriptionId = this.connection.onAccountChange(
        publicKey,
        (accountInfo, context) => {
          callback({
            address: address,
            lamports: accountInfo.lamports,
            slot: context.slot,
            chain: SUPPORTED_CHAINS.SOLANA
          });
        },
        'confirmed'
      );

      return { success: true, subscriptionId };
    } catch (error) {
      console.error('❌ Failed to subscribe to account:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Create new Solana wallet
   */
  static generateWallet() {
    const keypair = Keypair.generate();
    return {
      publicKey: keypair.publicKey.toString(),
      secretKey: JSON.stringify(Array.from(keypair.secretKey))
    };
  }

  /**
   * Get current network fees
   */
  async getNetworkFees() {
    try {
      const { feeCalculator } = await this.connection.getRecentBlockhash();
      return {
        success: true,
        data: {
          lamportsPerSignature: feeCalculator.lamportsPerSignature,
          solPerSignature: feeCalculator.lamportsPerSignature / LAMPORTS_PER_SOL
        }
      };
    } catch (error) {
      console.error('❌ Failed to get network fees:', error);
      return { success: false, error: error.message };
    }
  }
}
