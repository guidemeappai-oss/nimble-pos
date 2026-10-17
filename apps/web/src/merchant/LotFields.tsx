import {t} from '../i18n';
export type LotDraft={label:string;expiresAt:string|null};
export function LotFields({value,onChange,name=''}:{value:LotDraft;onChange:(v:LotDraft)=>void;name?:string}){
 return <fieldset><legend>{t('Lot details')} {name}</legend><label>{t('Lot label')}<input maxLength={120} value={value.label} onChange={e=>onChange({...value,label:e.target.value})}/></label><label>{t('Expiry date and time (UTC; empty means unknown)')}<input type="datetime-local" value={value.expiresAt?.slice(0,16)??''} onChange={e=>onChange({...value,expiresAt:e.target.value?new Date(e.target.value+'Z').toISOString():null})}/></label></fieldset>;
}
