import {esc,field,textarea,dialog,submit,toast,heading} from './shared/ui.js';
import {locationPicker} from './shared/maps.js';
export async function branchesPage(api,root){
  const [branches,plan]=await Promise.all([api.request(`/shops/${root}/branches`),api.request(`/shops/${root}/plan`)]);
  const enabled=plan.current_plan==='BUSINESS_PLUS';
  return {branches,html:`${heading('Филиалы',`${branches.length} / 15 · один бизнес, отдельные физические точки`)}${!enabled?'<p class="notice">Дополнительные филиалы доступны на BUSINESS PLUS. Данные сохранены.</p>':''}<div class="actions">${enabled&&branches.length<15?'<button class="button" data-branch-create>+ Добавить филиал</button>':''}${enabled&&branches.length>=15?'<p>Нужно больше 15 филиалов?</p><button class="button" data-branch-contact>Связаться с нами</button>':''}</div><div class="cards">${branches.map(b=>`<article class="card"><span class="status">${b.is_main?'Основной филиал':'ФИЛИАЛ'}</span><h2>${esc(b.display_name||b.name)}</h2><b>${esc(b.branch_code||b.store_code)}</b><p>${esc(b.address)}</p><p>${esc(b.latitude)}, ${esc(b.longitude)} · ${esc(b.branch_status)}${b.subscription_locked?' · Недоступен по тарифу':''}</p><p>Товары: ${Number(b.product_count)} · Сотрудники: ${Number(b.staff_count)}</p><div class="actions"><button class="button soft" data-branch-edit="${b.id}">Редактировать</button>${!b.is_main&&b.branch_status!=='archived'?`<button class="button soft" data-branch-archive="${b.id}">Архивировать</button>`:''}</article>`).join('')}</div>`};
}
export function bindBranches(container,{api,root,branches,reload}){
  const edit=branch=>{
    const modal=dialog(`<form class="form">${field('Название филиала','name',branch?.name||'','text','required maxlength="100"')}${field('Адрес','address',branch?.address||'','text','required maxlength="500"')}<div id="branchMap"></div>${field('Широта','latitude',branch?.latitude??'','number','required step="any" min="-90" max="90"')}${field('Долгота','longitude',branch?.longitude??'','number','required step="any" min="-180" max="180"')}${field('Телефон','phone',branch?.phone||'','tel')}${field('Часы работы','working_hours',branch?.working_hours||'')}<p>Код ${branch?esc(branch.branch_code||branch.store_code):'будет создан сервером после сохранения'}.</p><button class="button">${branch?'Сохранить':'Проверить и создать филиал'}</button></form>`,branch?'Редактировать филиал':'Добавить филиал');
    const form=modal.querySelector('form');
    const dispose=locationPicker(modal.querySelector('#branchMap'),p=>{form.elements.latitude.value=p.lat;form.elements.longitude.value=p.lng;},{lat:Number(branch?.latitude)||41.3111,lng:Number(branch?.longitude)||69.2406});
    modal.addEventListener('close',()=>dispose?.(),{once:true});
    form.onsubmit=e=>{e.preventDefault();submit(form,async values=>{
      if(!window.confirm(`Проверьте филиал:\n${values.name}\n${values.address}\n${values.latitude}, ${values.longitude}\nСохранить?`))return;
      const created=await api.request(`/shops/${root}/branches/${branch?branch.id:'create'}`,{method:branch?'PATCH':'POST',body:values});
      modal.close();await reload();toast(`Филиал сохранён. Код: ${created.store_code}`);
    });};
  };
  container.querySelector('[data-branch-create]')?.addEventListener('click',()=>edit());
  container.querySelectorAll('[data-branch-edit]').forEach(button=>button.onclick=()=>edit(branches.find(b=>Number(b.id)===Number(button.dataset.branchEdit))));
  container.querySelectorAll('[data-branch-archive]').forEach(button=>button.onclick=async()=>{if(!window.confirm('Архивировать филиал? Он исчезнет из поиска и карты; работа сотрудников будет остановлена. Товары, остатки, сотрудники и история сохранятся.'))return;try{await api.request(`/shops/${root}/branches/${button.dataset.branchArchive}`,{method:'DELETE',body:{confirmation:`ARCHIVE ${button.dataset.branchArchive}`}});await reload();toast('Филиал архивирован');}catch(error){toast(error.message);}});
  container.querySelector('[data-branch-contact]')?.addEventListener('click',()=>{
    const modal=dialog(`<form class="form"><p>Расскажите, сколько филиалов у вашей сети и что вам необходимо.</p>${textarea('Ваш запрос','message','')}<button class="button">Отправить</button></form>`,'Сотрудничество с YAQINTOP SELLER');
    const form=modal.querySelector('form');form.elements.message.required=true;form.elements.message.maxLength=4000;
    form.onsubmit=e=>{e.preventDefault();submit(form,async values=>{await api.request(`/shops/${root}/branch-expansion`,{method:'POST',body:values});modal.close();toast('Заявка отправлена');});};
  });
}
export async function mapPosLocations({api,shop,shops,id}){
  const details=await api.request(`/api/stores/${shop.id}/integrations/${id}`);
  const root=Number(shop.root_shop_id||shop.business_id||shop.id);
  const locations=details.locations||[];
  const candidates=shops.filter(s=>Number(s.root_shop_id||s.business_id||s.id)===root&&!s.subscription_locked&&s.branch_status!=='archived');
  const modal=dialog(`<form class="form"><p>Каждая внешняя POS-точка импортирует цены и остатки только в назначенный филиал.</p>${locations.map((l,i)=>`<label>${esc(l.external_location_name||l.external_location_id)}<select name="location_${i}" required><option value="">Выберите филиал</option>${candidates.map(s=>`<option value="${s.id}" ${Number(l.mapmarket_store_id)===Number(s.id)&&l.mapping_confirmed?'selected':''}>${esc(s.name)} · ${esc(s.store_code)}</option>`).join('')}</select></label>`).join('')}<button class="button">Сохранить сопоставление</button></form>`,'POS → филиалы');
  const form=modal.querySelector('form');form.onsubmit=e=>{e.preventDefault();submit(form,async values=>{for(const [i,location] of locations.entries())await api.request(`/api/stores/${shop.id}/integrations/${id}/locations/${encodeURIComponent(location.external_location_id)}`,{method:'PUT',body:{branch_id:Number(values[`location_${i}`]),is_enabled:true}});modal.close();toast('POS-точки сопоставлены с филиалами');});};
}
