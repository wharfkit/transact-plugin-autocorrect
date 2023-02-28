import {Asset, Int64, Name, Struct, UInt32} from '@wharfkit/session'

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
