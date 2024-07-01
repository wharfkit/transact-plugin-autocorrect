import {
    AbstractTransactPlugin,
    Action,
    API,
    Asset,
    prependAction,
    ResolvedSigningRequest,
    SigningRequest,
    TransactContext,
    TransactHookResponse,
    TransactHookTypes,
} from '@wharfkit/session'
import {Resources, SampleUsage} from '@wharfkit/resources'

import {getException} from './exception'
import {Buyrambytes, Powerup} from './types'
import defaultTranslations from './translations'

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
    // WAX
    '1064487b3cd1a897ce03ae5b6a865651747e2e152090f99c1d19d44e01aea5a4': {
        features: [ChainFeatures.BuyRAM, ChainFeatures.PowerUp],
        sampleAccount: 'boost.wax',
        symbol: Asset.Symbol.from('8,WAX'),
    },
}

/** Multiply all resource purchases to provide extra based on inaccurate estimates */
const multiplier = 1.5

export class TransactPluginAutoCorrect extends AbstractTransactPlugin {
    public id = 'transact-plugin-autocorrect'
    public translations = defaultTranslations
    public sample: SampleUsage | null = null
    public price: Asset | null = null
    public resources: string[] = []
    public iterations = 0

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
        // Abort if no UI is present
        if (!context.ui) {
            return {request}
        }

        // Reset internal state between transactions
        this.price = null
        this.resources = []
        this.iterations = 0

        // Retrieve translation helper from the UI, passing the app ID
        const t = context.ui.getTranslate(this.id)

        // Notifify the UI that we are checking the transaction
        const checkingPromise = context.ui
            .prompt({
                title: t('checking', {default: 'Checking transaction'}),
                body: '',
                elements: [],
            })
            .catch((error) => {
                // Throw if what we caught was a cancelation
                if (error) {
                    throw error
                }
                // Otherwise return the original if no error occurred but this was rejected
                return {request}
            })

        // Retrieve account data for the current account
        const account = await context.client.v1.chain.get_account(context.permissionLevel.actor)

        // Attempt to correct this transaction
        const correctedPromise = this.correct(request, context, account)

        const modified = await Promise.race([checkingPromise, correctedPromise])

        // If the request wasn't modified and no price exists, just return
        if (modified === request && !this.price) {
            return {request}
        }

        // Create unique set of resources that will be purchased
        const resources = Array.from(new Set(this.resources)).join('/')

        // Initiate a new cancelable prompt to inform the user of the fee required
        return context.ui
            .prompt({
                title: t('fee.title', {default: 'Accept Transaction Fee?'}),
                body: t('fee.body', {
                    default:
                        'Additional resources ({{resource}}) are required for your account to perform this transaction. Would you like to automatically purchase these resources from the network and proceed?',
                    resource: resources,
                }),
                elements: [
                    {
                        type: 'asset',
                        data: {
                            label: t('fee.cost', {
                                default: 'Cost of {{resource}}',
                                resource: resources,
                            }),
                            value: this.price,
                        },
                    },
                    {
                        type: 'accept',
                    },
                ],
            })
            .then(() => ({request: modified as SigningRequest}))
            .catch((error) => {
                // Throw if what we caught was a cancelation
                if (error) {
                    throw error
                }
                // Otherwise return the original if no error occurred but this was rejected
                return {request}
            })
    }

    async correct(
        request: SigningRequest,
        context: TransactContext,
        account: API.v1.AccountObject
    ): Promise<SigningRequest> {
        // TODO: Remove this once we are confident it won't create infinite loops against bad APIs
        // Keep track of how many interations have been done
        this.iterations++
        if (this.iterations > 3) {
            throw new Error('Too many iterations. Please report this bug if you see it.')
        }

        // If the chain is not configured to correct issues or no UI is present, abort.
        const config = chains[String(context.chain.id)]
        if (!config || !context.ui) {
            return request
        }

        // Set instance of resource library
        const resources = new Resources({
            api: context.client,
            sampleAccount: config.sampleAccount,
        })

        // Resolve any placeholders and complete the transaction for compute.
        const resolved = await context.resolve(request)

        // Call compute_transaction against the resolved transaction to detect any issues.
        return context.client.v1.chain
            .compute_transaction(resolved.transaction)
            .then(() => {
                return request
            })
            .catch((response) => {
                // Extract any exceptions from the response
                if (response.error) {
                    switch (response.error.name) {
                        case 'tx_net_usage_exceeded': {
                            const [, net_usage] = response.error.details[0].message.match(
                                /transaction net usage is too high: (\d+) > 0/
                            )
                            const needed = Number(net_usage) * multiplier
                            if (config.features.includes(ChainFeatures.PowerUp)) {
                                return this.powerup(
                                    context,
                                    resolved,
                                    account,
                                    resources,
                                    0,
                                    needed
                                )
                            }
                            break
                        }
                        case 'tx_cpu_usage_exceeded': {
                            const [, cpu_usage] = response.error.details[0].message.match(
                                /billed CPU time \((\d+) us\) is greater than the maximum billable CPU time for the transaction/
                            )
                            const needed = Number(cpu_usage) * multiplier
                            if (config.features.includes(ChainFeatures.PowerUp)) {
                                return this.powerup(
                                    context,
                                    resolved,
                                    account,
                                    resources,
                                    needed,
                                    0
                                )
                            }
                            break
                        }
                        case 'ram_usage_exceeded': {
                            const [, , needs, has] = response.error.details[0].message.match(
                                /account (\w.+) has insufficient ram; needs (\d+) bytes has (\d+) bytes/
                            )
                            const needed = (Number(needs) - Number(has)) * multiplier
                            if (config.features.includes(ChainFeatures.BuyRAM)) {
                                return this.buyram(context, resolved, account, resources, needed)
                            }
                            break
                        }
                        default: {
                            // no errors detected
                            break
                        }
                    }
                }
                // Return the request
                return request
            })
    }
    async buyram(
        context: TransactContext,
        resolved: ResolvedSigningRequest,
        account: API.v1.AccountObject,
        resources: Resources,
        needed: number
    ): Promise<SigningRequest> {
        // Get state of the blockchain and determine RAM price
        const config = chains[String(context.chain.id)]
        const ram = await resources.v1.ram.get_state()
        if (!this.sample) {
            this.sample = await resources.getSampledUsage()
        }

        // Determine price of resources
        const price = Asset.from(ram.price_per(needed).value, config.symbol)

        // Keep a running total of the price
        if (this.price) {
            this.price.units.add(price.units)
        } else {
            this.price = price
        }

        // And which resources are being paid for by this fee
        this.resources.push('RAM')

        // TODO: Implement maximum RAM fee to ensure potential bugs don't cause massive fees
        // How to determine a normal price per network?
        // const maxFee = 1
        // if (this.price.value > maxFee) {
        //     throw new Error('Fee is too high')
        // }

        // Create a new buyrambytes action to append
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

        // Attempt to correct the new request
        return this.correct(newRequest, context, account)
    }

    async powerup(
        context: TransactContext,
        resolved: ResolvedSigningRequest,
        account: API.v1.AccountObject,
        resources: Resources,
        cpu: number,
        net: number
    ): Promise<SigningRequest> {
        // Get state of the blockchain and determine powerup price
        const config = chains[String(context.chain.id)]
        const powerup = await resources.v1.powerup.get_state()
        if (!this.sample) {
            this.sample = await resources.getSampledUsage()
        }

        // If powering up, always set a minimum to avoid API speed variance
        if (cpu < 2500) {
            cpu = 2500
        }

        if (net < 10000) {
            net = 10000
        }

        // Determine price of resources
        const price = Asset.from(
            Number(powerup.cpu.price_per(this.sample, cpu)) +
                Number(powerup.net.price_per(this.sample, net)) * multiplier,
            config.symbol
        )

        // Keep a running total of the price
        if (this.price) {
            this.price.units.add(price.units)
        } else {
            this.price = price
        }

        // And which resources are being paid for by this fee
        this.resources.push('CPU', 'NET')

        // TODO: Implement maximum RAM fee to ensure potential bugs don't cause massive fees
        // How to determine a normal price per network?
        // const maxFee = 1
        // if (this.price.value > maxFee) {
        //     throw new Error('Fee is too high')
        // }

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
                max_payment: price,
            }),
        })

        // Create a new request based on this full transaction
        let modifiedRequest = prependAction(resolved.request, newAction)

        // Determine if the account has enough RAM to powerup
        const ram_needed = 410 // 405 appears to be the exact amount, but purchase an additional small buffer
        if (Number(account.ram_quota) - Number(account.ram_usage) < ram_needed) {
            // Get state of the blockchain and determine RAM price
            const config = chains[String(context.chain.id)]
            const ram = await resources.v1.ram.get_state()
            if (!this.sample) {
                this.sample = await resources.getSampledUsage()
            }

            // Create a new buyrambytes action to append
            const ramAction = Action.from({
                account: 'eosio',
                name: 'buyrambytes',
                authorization: [resolved.signer],
                data: Buyrambytes.from({
                    payer: resolved.signer.actor,
                    receiver: resolved.signer.actor,
                    bytes: ram_needed,
                }),
            })

            // Modify the account object to prevent multiple purchases during recurrsion
            account.ram_quota.add(ram_needed)

            // Modify the request
            modifiedRequest = prependAction(modifiedRequest, ramAction)

            // Determine price of resources
            const ramPrice = Asset.from(ram.price_per(ram_needed).value, config.symbol)
            this.price.units.add(ramPrice.units)

            // Notify that RAM is also being purchased
            this.resources.push('RAM')
        }

        // Attempt to correct the new request
        return this.correct(modifiedRequest, context, account)
    }
}
