import {mockFetch} from '$test/utils/mock-fetch'
import {TransactPluginTemplate} from '../../src/index'

import {PrivateKey, Session, SessionOptions, WalletPluginPrivateKey} from '@wharfkit/session'

const wallet = new WalletPluginPrivateKey({
    privateKey: PrivateKey.from('5Jtoxgny5tT7NiNFp1MLogviuPJ9NniWjnU4wKzaX4t7pL4kJ8s'),
})

const mockSessionOptions: SessionOptions = {
    chain: {
        id: '73e4385a2708e6d7048834fbc1079f2fabb17b3c125b146af438971e90716c4d',
        url: 'https://jungle4.greymass.com',
    },
    fetch: mockFetch,
    permissionLevel: 'wharfkit1131@test',
    transactPlugins: [new TransactPluginTemplate()],
    walletPlugin: wallet,
}

suite('example', function () {
    test('plugin usage', async function () {
        const session = new Session(mockSessionOptions)
        const action = {
            authorization: [
                {
                    actor: 'wharfkit1115',
                    permission: 'test',
                },
            ],
            account: 'eosio.token',
            name: 'transfer',
            data: {
                from: 'wharfkit1115',
                to: 'wharfkittest',
                quantity: '0.0001 EOS',
                memo: 'wharfkit plugin - resource provider test (maxFee: 0.0001)',
            },
        }
        await session.transact(
            {
                action,
            },
            {broadcast: false}
        )
    })
})
