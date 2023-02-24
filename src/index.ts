import {
    AbstractTransactPlugin,
    Action,
    Asset,
    Cancelable,
    Canceled,
    Int64,
    Name,
    PromptResponse,
    ResolvedSigningRequest,
    SigningRequest,
    Struct,
    TransactContext,
    TransactHookResponse,
    TransactHookTypes,
    Transaction,
    UInt32,
} from '@wharfkit/session'
import {PowerUpState, RAMState, REXState, Resources, SampleUsage} from '@greymass/eosio-resources'
import {getException} from './exception'

enum ChainFeatures {
    /** eosio.buyram / eosio.buyrambytes https://github.com/EOSIO/eosio.contracts/blob/master/contracts/eosio.system/src/delegate_bandwidth.cpp#L43 */
    BuyRAM,

    /** FIO Bundled Transactions https://fio.wiki/knowledge-base/protocol/bundling-and-fees/ */
    // FIOBundledFees, // NYI

    /** eosio.powerup https://github.com/EOSIO/eosio.contracts/pull/397 */
    PowerUp,

    /** eosio.rentcpu / eosio.rentnet https://github.com/EOSIO/eosio.contracts/blob/master/contracts/eosio.system/src/powerup.cpp */
    // REX, // NYI

    /** eosio.delegatebw https://github.com/EOSIO/eosio.contracts/blob/master/contracts/eosio.system/src/delegate_bandwidth.cpp#L372 */
    // Staking, // NYI
}

interface ChainConfig {
    features: ChainFeatures[]
    sampleAccount: string
    symbol: Asset.Symbol
}

const chains: Record<string, ChainConfig> = {
    // EOS
    aca376f206b8fc25a6ed44dbdc66547c36c6c33e3a119ffbeaef943642f0e906: {
        features: [ChainFeatures.BuyRAM, ChainFeatures.PowerUp],
        sampleAccount: 'teamgreymass',
        symbol: Asset.Symbol.from('4,EOS'),
    },
    // Jungle 4
    '73e4385a2708e6d7048834fbc1079f2fabb17b3c125b146af438971e90716c4d': {
        features: [ChainFeatures.BuyRAM, ChainFeatures.PowerUp],
        sampleAccount: 'eosamsterdam',
        symbol: Asset.Symbol.from('4,EOS'),
    },
}

const multiplier = 1.5

// const resources_eos = new Resources({
//     api: new APIClient({
//         provider: new MockProvider(joinPath(__dirname, 'data'), 'https://eos.greymass.com'),
//     }),
// })

@Struct.type('powerup')
export class Powerup extends Struct {
    @Struct.field(Name) payer!: Name
    @Struct.field(Name) receiver!: Name
    @Struct.field(UInt32) days!: UInt32
    @Struct.field(Int64) net_frac!: Int64
    @Struct.field(Int64) cpu_frac!: Int64
    @Struct.field(Asset) max_payment!: Asset
}

@Struct.type('buyrambytes')
export class Buyrambytes extends Struct {
    @Struct.field(Name) payer!: Name
    @Struct.field(Name) receiver!: Name
    @Struct.field(UInt32) bytes!: UInt32
}

export class TransactPluginAutoCorrect extends AbstractTransactPlugin {
    public sample: SampleUsage | null = null
    register(context: TransactContext): void {
        if (!context.ui) {
            throw new Error('The TransactPluginAutoCorrect plugin requires a UI to be present.')
        }
        context.addHook(
            TransactHookTypes.beforeSign,
            async (
                request: SigningRequest,
                context: TransactContext
            ): Promise<TransactHookResponse> => this.run(request, context)
        )
    }
    async run(request: SigningRequest, context: TransactContext): Promise<TransactHookResponse> {
        // If the chain is not configured to correct issues or no UI is present, abort.
        const config = chains[String(context.chain.id)]
        if (!config || !context.ui) {
            return {request}
        }

        // Set instance of resource library
        const resources = new Resources({
            api: context.client,
            sampleAccount: config.sampleAccount,
        })

        // Resolve any placeholders and complete the transaction for compute.
        context.ui.status('Resolving transaction')
        const resolved = await context.resolve(request)

        // Call compute_transaction against the resolved transaction to detect any issues.
        context.ui.status('Checking transaction')
        const response = await context.client.v1.chain.compute_transaction(resolved.transaction)

        // Extract any exceptions from the response
        const exception = getException(response)
        if (exception) {
            switch (exception.name) {
                case 'tx_net_usage_exceeded': {
                    const {net_usage} = exception.stack[0].data
                    const needed = net_usage * multiplier
                    if (config.features.includes(ChainFeatures.PowerUp)) {
                        return this.powerup(request, context, resolved, resources, needed)
                    }
                    break
                }
                case 'tx_cpu_usage_exceeded': {
                    const {billed, billable} = exception.stack[0].data
                    const needed = (billed - billable) * multiplier
                    if (config.features.includes(ChainFeatures.PowerUp)) {
                        return this.powerup(request, context, resolved, resources, needed)
                    }
                    break
                }
                case 'ram_usage_exceeded': {
                    const {available, needs} = exception.stack[0].data
                    const needed = (needs - available) * multiplier
                    if (config.features.includes(ChainFeatures.BuyRAM)) {
                        return this.buyram(request, context, resolved, resources, needed)
                    }
                    break
                }
                default: {
                    // no errors detected
                    break
                }
            }
        }

        return {
            request,
        }
    }
    async buyram(
        request: SigningRequest,
        context: TransactContext,
        resolved,
        resources,
        needed
    ): Promise<TransactHookResponse> {
        const config = chains[String(context.chain.id)]
        if (context.ui) {
            // Get state of the blockchain and determine RAM price
            const ram = await resources.v1.ram.get_state()
            if (!this.sample) {
                this.sample = await resources.getSampledUsage()
            }
            const price = Asset.fromUnits(ram.price_per(needed) * 10000, config.symbol)

            // Initiate a new cancelable prompt to inform the user of the fee required
            const prompt: Cancelable<PromptResponse> = context.ui.prompt({
                title: 'Fee Required',
                body: 'Resources are required to complete this transaction. Accept fee?',
                elements: [
                    {
                        type: 'asset',
                        data: {
                            label: 'Fee required',
                            value: price,
                        },
                    },
                    {
                        type: 'accept',
                    },
                ],
            })

            // Example of how to cancel a prompt using a timeout
            // TODO: Remove this, it's just here for testing
            const timer = setTimeout(() => {
                prompt.cancel('canceled automatically through timeout')
            }, 3000)

            // Return the promise from the prompt
            return prompt.then(
                async () => {
                    // TODO: Implement maximum fee to ensure potential bugs don't cause massive fees
                    // Create the buyram action
                    const newAction = Action.from({
                        account: 'eosio',
                        name: 'buyrambytes',
                        authorization: [resolved.signer],
                        data: Buyrambytes.from({
                            payer: resolved.signer.actor,
                            receiver: resolved.signer.actor,
                            bytes: needed,
                        }),
                    })
                    // Create a new request based on this full transaction
                    const newRequest = await SigningRequest.create(
                        {
                            transaction: Transaction.from({
                                ...resolved.transaction,
                                actions: [newAction, ...resolved.transaction.actions],
                            }),
                        },
                        context.esrOptions
                    )
                    clearTimeout(timer) // TODO: Remove this, it's just here for testing
                    return await this.run(newRequest, context)
                },
                async () => {
                    clearTimeout(timer) // TODO: Remove this, it's just here for testing
                    return new Promise((r) => r({request}))
                }
            )
        }
        // If not configured for this chain just return the request inside a promise
        return new Promise((r) => r({request}))
    }
    async powerup(
        request: SigningRequest,
        context: TransactContext,
        resolved,
        resources,
        needed
    ): Promise<TransactHookResponse> {
        const config = chains[String(context.chain.id)]
        if (context.ui) {
            const powerup = await resources.v1.powerup.get_state()
            if (!this.sample) {
                this.sample = await resources.getSampledUsage()
            }

            const price = powerup.cpu.price_per_ms(this.sample, needed)

            // Initiate a new cancelable prompt to inform the user of the fee required
            const prompt: Cancelable<PromptResponse> = context.ui.prompt({
                title: 'Fee Required',
                body: 'Resources are required to complete this transaction. Accept fee?',
                elements: [
                    {
                        type: 'asset',
                        data: {
                            label: 'Fee required',
                            value: price,
                        },
                    },
                    {
                        type: 'accept',
                    },
                ],
            })

            // Example of how to cancel a prompt using a timeout
            // TODO: Remove this, it's just here for testing
            const timer = setTimeout(() => {
                prompt.cancel('canceled automatically through timeout')
            }, 30000)

            // Return the promise from the prompt
            return prompt.then(
                async () => {
                    // TODO: Implement maximum fee to ensure potential bugs don't cause massive fees
                    // Create a new powerup action to append
                    const newAction = Action.from({
                        account: 'eosio',
                        name: 'powerup',
                        authorization: [resolved.signer],
                        data: Powerup.from({
                            payer: resolved.signer.actor,
                            receiver: resolved.signer.actor,
                            days: 1,
                            net_frac: powerup.net.frac(this.sample, needed),
                            cpu_frac: powerup.cpu.frac(this.sample, needed),
                            max_payment: Asset.from(price, config.symbol),
                        }),
                    })
                    // Create a new request based on this full transaction
                    const newRequest = await SigningRequest.create(
                        {
                            transaction: Transaction.from({
                                ...resolved.transaction,
                                actions: [newAction, ...resolved.transaction.actions],
                            }),
                        },
                        context.esrOptions
                    )
                    clearTimeout(timer) // TODO: Remove this, it's just here for testing
                    return await this.run(newRequest, context)
                },
                async () => {
                    clearTimeout(timer) // TODO: Remove this, it's just here for testing
                    return new Promise((r) => r({request}))
                }
            )
        }
        // If not configured for this chain just return the request inside a promise
        return new Promise((r) => r({request}))
    }
}
