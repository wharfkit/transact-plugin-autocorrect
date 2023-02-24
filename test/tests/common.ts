import {mockFetch} from '$test/utils/mock-fetch'
import {TransactPluginAutoCorrect} from '../../src/index'

import {NameType, PrivateKey, Session, SessionArgs, SessionOptions} from '@wharfkit/session'
import {WalletPluginPrivateKey} from '@wharfkit/wallet-plugin-privatekey'

// ## Testing accounts
// | account@permission  | tokens | cpu | net | ram |
// | ------------------- | ------ | --- | --- | --- |
// | wharfkit1111@test   | ✅     | ✅  | ✅  | ✅  |
// | wharfkit1112@test   | ✅     | ❌  | ✅  | ✅  |
// | wharfkit1113@test   | ✅     | ✅  | ❌  | ✅  |
// | wharfkit1114@test   | ✅     | ✅  | ✅  | ❌  |
// | wharfkit1115@test   | ✅     | ❌  | ❌  | ❌  |
// | wharfkit1121@test   | ❌     | ✅  | ✅  | ✅  |
// | wharfkit1122@test   | ❌     | ❌  | ✅  | ✅  |
// | wharfkit1123@test   | ❌     | ✅  | ❌  | ✅  |
// | wharfkit1124@test   | ❌     | ✅  | ✅  | ❌  |
// | wharfkit1125@test   | ❌     | ❌  | ❌  | ❌  |
// | wharfkit1131@test   | ✅     | ❌  | ❌  | ✅  |
// | wharfkit1132@test   | ❌     | ❌  | ❌  | ✅  |
// | wharfkitnoop@cosign | ✅     | ✅  | ✅  | ✅  |

const wallet = new WalletPluginPrivateKey('5Jtoxgny5tT7NiNFp1MLogviuPJ9NniWjnU4wKzaX4t7pL4kJ8s')

const mockSessionArgs: SessionArgs = {
    chain: {
        id: '73e4385a2708e6d7048834fbc1079f2fabb17b3c125b146af438971e90716c4d',
        url: 'https://jungle4.greymass.com',
    },
    permissionLevel: 'wharfkit1125@test',
    walletPlugin: wallet,
}

const mockSessionOptions: SessionOptions = {
    fetch: mockFetch,
    transactPlugins: [new TransactPluginAutoCorrect()],
}

function createAction(account: NameType) {
    return {
        authorization: [
            {
                actor: account,
                permission: 'test',
            },
        ],
        account: 'eosio.token',
        name: 'transfer',
        data: {
            from: account,
            to: 'wharfkittest',
            quantity: '0.0001 EOS',
            memo: 'wharfkit plugin - autocorrect test',
        },
    }
}

suite('autocorrect', function () {
    suite('compute_transaction', function () {
        // Requires headless UserInterface instance
        // test('no cpu, has tokens', async function () {
        //     this.timeout(30 * 1000)
        //     const session = new Session(mockSessionArgs, mockSessionOptions)
        //     await session.transact(
        //         {
        //             action: createAction('wharfkit1112'),
        //         },
        //         {broadcast: false}
        //     )
        // })
        // test('no net, has tokens', async function () {
        //     const session = new Session(mockSessionArgs, mockSessionOptions)
        //     await session.transact(
        //         {
        //             action: createAction('wharfkit1113'),
        //         },
        //         {broadcast: false}
        //     )
        // })
        // test('no ram, has tokens', async function () {
        //     const session = new Session(mockSessionArgs, mockSessionOptions)
        //     await session.transact(
        //         {
        //             action: createAction('wharfkit1114'),
        //         },
        //         {broadcast: false}
        //     )
        // })
    })
})
