import {APIError} from '@wharfkit/session'

export function getException(response): APIError | null {
    if (response.error) {
        return response.error
    }
    return null
}
