import {AbstractTransactPlugin, TransactContext, TransactHookTypes} from '@wharfkit/session'

export class TransactPluginAutoCorrect extends AbstractTransactPlugin {
    register(context: TransactContext): void {
        context.addHook(TransactHookTypes.beforeSign, async (request, context) => {
            // eslint-disable-next-line no-console
            console.log('beforeSign hook called with', request, context)
            return {
                request,
            }
        })
    }
}
