import {
    AbstractTransactPlugin,
    Action,
    Asset,
    Cancelable,
    Canceled,
    prependAction,
    PromptResponse,
    SigningRequest,
    TransactContext,
    TransactHookResponse,
    TransactHookTypes,
    Transaction,
} from '@wharfkit/session'
import {Resources, SampleUsage} from '@greymass/eosio-resources'

import {getException} from './exception'
import {Buyrambytes, Powerup} from './types'
import defaultTranslations from './translations.json'

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
        sampleAccount: 'eosmechanics',
        symbol: Asset.Symbol.from('4,EOS'),
    },
}

/** Multiply all resource purchases to provide extra based on inaccurate estimates */
const multiplier = 1.5

export class TransactPluginAutoCorrect extends AbstractTransactPlugin {
    public id = 'transact-plugin-autocorrect'
    public translations = defaultTranslations
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

        // Retrieve translation helper from the UI, passing the app ID
        const t = context.ui.getTranslate(this.id)

        // Set instance of resource library
        const resources = new Resources({
            api: context.client,
            sampleAccount: config.sampleAccount,
        })

        // Resolve any placeholders and complete the transaction for compute.
        context.ui.status(t('resolving', {default: 'Resolving transaction'}))
        const resolved = await context.resolve(request)

        // Call compute_transaction against the resolved transaction to detect any issues.
        context.ui.status(t('checking', {default: 'Checking transaction'}))
        const response = await context.client.v1.chain.compute_transaction(resolved.transaction)

        // Extract any exceptions from the response
        const exception = getException(response)
        if (exception) {
            switch (exception.name) {
                case 'tx_net_usage_exceeded': {
                    const {net_usage} = exception.stack[0].data
                    const needed = net_usage * multiplier
                    if (config.features.includes(ChainFeatures.PowerUp)) {
                        return this.powerup(request, context, resolved, resources, 0, needed)
                    }
                    break
                }
                case 'tx_cpu_usage_exceeded': {
                    const {billed, billable} = exception.stack[0].data
                    const needed = (billed - billable) * multiplier
                    if (config.features.includes(ChainFeatures.PowerUp)) {
                        return this.powerup(request, context, resolved, resources, needed, 0)
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
            // Retrieve translation helper from the UI, passing the app ID
            const t = context.ui.getTranslate(this.id)

            // Get state of the blockchain and determine RAM price
            const ram = await resources.v1.ram.get_state()
            if (!this.sample) {
                this.sample = await resources.getSampledUsage()
            }
            const price = Asset.fromUnits(ram.price_per(needed) * 10000, config.symbol)

            // Initiate a new cancelable prompt to inform the user of the fee required
            const prompt: Cancelable<PromptResponse> = context.ui.prompt({
                title: t('fee.title', {default: 'Accept Transaction Fee?'}),
                body: t('fee.body', {
                    default:
                        'Additional resources ({{resource}}) are required for your account to perform this transaction. Would you like to automatically purchase these resources from the network and proceed?',
                    resource: 'RAM',
                }),
                elements: [
                    {
                        type: 'asset',
                        data: {
                            label: t('fee.cost', {
                                default: 'Cost of {{resource}}',
                                resource: 'RAM',
                            }),
                            value: price,
                        },
                    },
                    {
                        type: 'accept',
                    },
                ],
            })

            // Return the promise from the prompt
            return prompt
                .then(async () => {
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
                    const newRequest = prependAction(resolved.request, newAction)
                    return await this.run(newRequest, context)
                })
                .catch((e) => {
                    // Throw if what we caught was a cancelation
                    if (e instanceof Canceled) {
                        throw e
                    }
                    // Otherwise if it wasn't a cancel, it was a reject, and continue without modification
                    return new Promise((r) => r({request})) as Promise<TransactHookResponse>
                })
        }
        // If not configured for this chain just return the request inside a promise
        return new Promise((r) => r({request}))
    }
    async powerup(
        request: SigningRequest,
        context: TransactContext,
        resolved,
        resources,
        cpu,
        net
    ): Promise<TransactHookResponse> {
        const config = chains[String(context.chain.id)]
        if (context.ui) {
            // Retrieve translation helper from the UI, passing the app ID
            const t = context.ui.getTranslate(this.id)

            const powerup = await resources.v1.powerup.get_state()
            if (!this.sample) {
                this.sample = await resources.getSampledUsage()
            }

            // Set a floor to prevent hitting minimums
            if (cpu < 1000) {
                cpu = 1000
            }

            // Determine price of resources
            const price =
                Number(powerup.cpu.price_per(this.sample, cpu)) +
                Number(powerup.net.price_per(this.sample, net))

            const resourceLabel = cpu > 0 ? 'CPU' : 'NET'

            // Initiate a new cancelable prompt to inform the user of the fee required
            const prompt: Cancelable<PromptResponse> = context.ui.prompt({
                title: t('fee.title', {default: 'Accept Transaction Fee?'}),
                body: t('fee.body', {
                    default:
                        'Additional resources ({{resource}}) are required for your account to perform this transaction. Would you like to automatically purchase these resources from the network and proceed?',
                    resource: resourceLabel,
                }),
                elements: [
                    {
                        type: 'asset',
                        data: {
                            label: t('fee.cost', {
                                default: 'Cost of {{resource}}',
                                resource: resourceLabel,
                            }),
                            value: price,
                        },
                    },
                    {
                        type: 'accept',
                    },
                ],
            })

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
                            net_frac: powerup.net.frac(this.sample, net),
                            cpu_frac: powerup.cpu.frac(this.sample, cpu),
                            max_payment: Asset.from(price, config.symbol),
                        }),
                    })

                    // Create a new request based on this full transaction
                    const newRequest = prependAction(resolved.request, newAction)
                    return await this.run(newRequest, context)
                },
                async () => {
                    return new Promise((r) => r({request}))
                }
            )
        }
        // If not configured for this chain just return the request inside a promise
        return new Promise((r) => r({request}))
    }
}
