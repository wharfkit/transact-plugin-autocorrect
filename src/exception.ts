import {API} from '@wharfkit/session'

export function getException(
    response: API.v1.SendTransactionResponse
): API.v1.SendTransactionResponseException | null {
    if (response.processed.except) {
        return response.processed.except
    }
    return null
}
