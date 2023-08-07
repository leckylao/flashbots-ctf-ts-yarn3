import { JsonRpcProvider, keccak256, Wallet, TransactionRequest, toBigInt, Interface, Network, LogParams, AbiCoder } from 'ethers'
import { Mutex } from "async-mutex"
import Env from './lib/env'

// lib
import MevShareClient, {
    BundleParams,
    HintPreferences,
    IPendingBundle,
    IPendingTransaction,
    TransactionOptions
} from "@flashbots/mev-share-client"
// import { sendTx, setupTxExample } from './lib/sendTx'
import { AsyncArray } from './lib/async'
import MevShareCTFMagicNumberV1 from './abis/MevShareCTFMagicNumberV1.json'

const NUM_TARGET_BLOCKS = 5

/**
 * Generate a transaction to backrun a pending mev-share transaction and send it to mev-share.
 */
const sendTestBackrunBundle = async (
    provider: JsonRpcProvider,
    pendingTx: IPendingTransaction,
    mevshare: MevShareClient,
    targetBlock: number,
    log: LogParams
    ) => {
    // const mevShareCTFSimple = new Contract(to, MevShareCTFSimple);
    console.log("log: ", log);
    const abiCoder = AbiCoder.defaultAbiCoder();
    const range = abiCoder.decode(['uint256', 'uint256'], log.data)
    console.log("range: ", range);
    console.log("To address:", log.address);
    const feeData = await provider.getFeeData();
    console.log("feeData: ", feeData);
    const wallet = new Wallet(Env.senderKey).connect(provider);
    const mevShareCTFMagicNumberV1 = new Interface(MevShareCTFMagicNumberV1);
    let bundleParams: BundleParams
    let backrunResult
    for (let index = range[0]; index < range[1]; index++) {
        const claimReward = mevShareCTFMagicNumberV1.encodeFunctionData("claimReward", [index]);
        const tx: TransactionRequest = {
            type: 2,
            chainId: provider._network.chainId,
            to: log.address,
            nonce: await wallet.getNonce(),
            value: 0,
            gasLimit: 1000000,
            data: claimReward,
            maxFeePerGas: toBigInt(feeData.maxFeePerGas || 42) + BigInt(0),
            maxPriorityFeePerGas: toBigInt(feeData.maxPriorityFeePerGas || 2) + BigInt(0),
        }
        console.log("tx:", tx);
        const bundle = [
            {hash: pendingTx.hash},
            {tx: await wallet.signTransaction(tx), canRevert: false},
        ]
        console.log(`sending backrun bundles targeting next ${NUM_TARGET_BLOCKS} blocks...`)
        bundleParams = {
            inclusion: {
                block: targetBlock,
                maxBlock: targetBlock + NUM_TARGET_BLOCKS,
            },
            body: bundle,
        }
        backrunResult = await mevshare.sendBundle(bundleParams)
    }
    // const tx: TransactionRequest = {
    //     type: 1,
    //     chainId: provider._network.chainId,
    //     to: to,
    //     nonce: await wallet.getNonce(),
    //     value: 0,
    //     gasLimit: 1000000,
    //     // data: hexlify(toUtf8Bytes(flair || "im shariiiiiing")),
    //     data: claimReward,
    //     // maxFeePerGas: toBigInt(feeData.maxFeePerGas || 42) + BigInt(0),
    //     // maxPriorityFeePerGas: toBigInt(feeData.maxPriorityFeePerGas || 2) + BigInt(0),
    // }

    // send bundle w/ (basefee + 100)gwei gas fee
    // const {tx, wallet} = await setupTxExample(provider, BigInt(1e9) * BigInt(1e3), "im backrunniiiiing")
    // const backrunTx = {
    //     ...tx,
    //     nonce: tx.nonce ? tx.nonce + 1 : undefined,
    // }
    return {
        bundleParams,
        backrunResult,
    }
}

/** Async handler which backruns an mev-share tx with another basic example tx. */
const handleBackrun = async (
    pendingTx: IPendingTransaction,
    provider: JsonRpcProvider,
    mevshare: MevShareClient,
    pendingMutex: Mutex,
    pendingTxHashes: AsyncArray<string>,
): Promise<void> => {
    // console.log("pendingTxHashes", await pendingTxHashes.get())
    // if (!(await pendingTxHashes.includes(pendingTx.hash))) {
        // ignore txs we didn't send. they break the bundle (nonce error) bc we're using one account to do everything
    //     return
    // } else {
    console.log("pending tx: ", pendingTx)
    console.log("pending tx logs: ", pendingTx.logs)
    // }
    let log: LogParams;
    // if (pendingTx.logs && pendingTx.logs[0].address == "0x118bcb654d9a7006437895b51b5cd4946bf6cdc2"){
    // if (pendingTx.logs && pendingTx.logs[0].address == "0x9be957d1c1c1f86ba9a2e1215e9d9eefde615a56"){
    if (pendingTx.logs && pendingTx.logs[0].address == "0xe8b7475e2790409715af793f799f3cc80de6f071"){
        log = pendingTx.logs[0];
        console.log("Tx found:", pendingTx.hash);
    }else{
        console.log("Tx not found, skipping")
        return;
    }
    const targetBlock = await provider.getBlockNumber() + 1
    const {
        bundleParams,
        backrunResult,
    } = await sendTestBackrunBundle(provider, pendingTx, mevshare, targetBlock, log)
    console.log("backrun result", backrunResult)
    console.log("backrun bundleParams", bundleParams)

    // watch future blocks for backrun tx inclusion
    // for (let i = 0; i < NUM_TARGET_BLOCKS; i++) {
    //     const currentBlock = targetBlock + i
    //     if (!pendingMutex.isLocked()) {
    //         // mutex was released by another handler, so we can exit
    //         break
    //     }
    //     console.log(`tx ${pendingTx.hash} waiting for block`, currentBlock)
    //     // stall until target block is available
    //     while (await provider.getBlockNumber() < currentBlock) {
    //         await new Promise(resolve => setTimeout(resolve, 6000))
    //     }

    //     // check for inclusion of backrun tx in target block
    //     const backrunTx = (bundleParams.body[1] as any).tx
    //     if (backrunTx) {
    //         const checkTxHash = keccak256(backrunTx)
    //         const receipt = await provider.getTransactionReceipt(checkTxHash)
    //         if (receipt?.status === 1) {
    //             console.log(`bundle included! (found tx ${receipt.hash})`)

    //             // simulate for funzies
    //             // const simOptions = {
    //             //     parentBlock: receipt.blockNumber - 1,
    //             // }
    //             // const simResult = await mevshare.simulateBundle(bundleParams, simOptions)
    //             // console.log(`simResult (simOptions=${JSON.stringify(simOptions, null, 2)})`, simResult)
    //             // console.log(`profit: ${formatEther(simResult.profit)} ETH`)
                
    //             // release mutex so the main thread can exit
    //             pendingMutex.release()
    //             break
    //         } else {
    //             console.warn(`backrun tx ${checkTxHash} not included in block ${currentBlock}`)
    //         }
    //     }
    // }
    // await pendingTxHashes.filter(hash => hash !== pendingTx.hash)
    // console.log("dropped target tx", pendingTx.hash)
}

/**
 * Sends a tx on every block and backruns it with a simple example tx.
 *
 * Continues until we land a backrun, then exits.
 */
const main = async () => {
    const provider = new JsonRpcProvider(Env.providerUrl, new Network("goerli", 5));
    const authSigner = new Wallet(Env.authKey, provider).connect(provider);
    // const authSigner = Wallet.createRandom();
    const mevshare = MevShareClient.useEthereumGoerli(authSigner)

    // used for tracking txs we sent. we only want to backrun txs we sent, 
    // since we're using one account and incrementing the nonce of the bundle's 2nd tx
    const pendingTxHashes = new AsyncArray<string>()

    // used for blocking this thread until the handler is done processing
    const pendingMutex = new Mutex()
    
    // listen for txs
    const txHandler = mevshare.on("transaction", async (pendingTx: IPendingTransaction) => {
        await handleBackrun(pendingTx, provider, mevshare, pendingMutex, pendingTxHashes)
    })
    console.log("listening for transactions...")

    await pendingMutex.acquire()
    // send a tx that we can backrun on every block
    // tx will be backrun independently by the `handleBackrun` callback
    // const blockHandler = await provider.on("block", async (blockNum) => {
    //     if (await pendingTxHashes.length() === 0) {
    //         // const res = await sendTx(provider, {logs: true, contractAddress: true, calldata: true, functionSelector: true}, blockNum + NUM_TARGET_BLOCKS)
    //         const res = await mevshare.sendTransaction(signedTx,
    //             {hints: {logs: false, contractAddress: false, calldata: false, functionSelector: false},
    //             maxBlockNumber: blockNum + NUM_TARGET_BLOCKS});
    //         console.log("sent tx", res)
    //         pendingTxHashes.push(res)
    //     }
    // })

    // will block until one of the handlers releases the mutex
    await pendingMutex.acquire()
    pendingMutex.release()

    // stop listening for txs
    txHandler.close()
    // await blockHandler.removeAllListeners()
}

main().then(() => {
    process.exit(0)
})