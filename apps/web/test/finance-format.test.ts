import {expect,it} from 'vitest';
import {cryptoAmount} from '../src/merchant/format';
import {minorText} from '../src/merchant/FinanceBoard';
it('formats signed exact asset flows without a negative fractional component or floating-point rounding',()=>{
 expect(cryptoAmount('-450000','NIM')).toBe('-4.5 NIM');expect(cryptoAmount('-1','NIM')).toBe('-0.00001 NIM');expect(cryptoAmount('-1234567','USDT')).toBe('-1.234567 USDT');expect(cryptoAmount('123456789012345678901','USDT')).toBe('123,456,789,012,345.678901 USDT');
 expect(minorText('-901','EUR')).toBe('-9.01 EUR');expect(minorText('123456789012345678901','PLN')).toBe('1,234,567,890,123,456,789.01 PLN');expect(minorText(null,'EUR')).toBe('Unknown');
});
