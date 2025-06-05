import {API, APIError} from '@wharfkit/session'

export function getException(response): API.v1.SendTransactionResponseException | APIError | null {
    if (response.error) {
        return response.error
    }
    if (response.processed.except) {
        return response.processed.except
    }
    return null
}
