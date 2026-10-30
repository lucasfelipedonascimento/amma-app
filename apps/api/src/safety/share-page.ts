/**
 * Página que o contato vê ao abrir o link da viagem. HTML estático: busca /share/:token/data a cada 10 s
 * e escreve o texto com `textContent` (nada vindo do servidor entra como HTML).
 */
export const SAFETY_PAGE = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Acompanhar corrida — AMMA</title>
<style>
body{font-family:system-ui,sans-serif;background:#fbf8f4;color:#1e1a18;margin:0;padding:16px}
main{max-width:480px;margin:0 auto}
h1{color:#c9221a;font-size:22px;margin:0 0 4px}
.card{background:#fff;border-radius:12px;padding:14px;margin:12px 0;border:1px solid #e6dfd6}
.k{color:#6b625c;font-size:12px;text-transform:uppercase;font-weight:700}
.v{font-size:17px;font-weight:600;margin-bottom:8px}
.alert{background:#c9221a;color:#fff;border-radius:12px;padding:14px;font-weight:800;display:none}
a{color:#c9221a}
</style></head><body><main>
<h1>Acompanhar corrida</h1>
<p id="who" class="k">Carregando…</p>
<div id="alert" class="alert">🚨 Alerta de emergência acionado nesta corrida. Tente falar com a pessoa; se não conseguir, ligue 190.</div>
<div class="card"><div class="k">Situação</div><div id="status" class="v">—</div>
<div class="k">Motorista</div><div id="driver" class="v">—</div>
<div class="k">Veículo</div><div id="vehicle" class="v">—</div>
<div class="k">Saída</div><div id="from" class="v">—</div>
<div class="k">Destino</div><div id="to" class="v">—</div>
<div class="k">Posição agora</div><div id="pos" class="v">—</div></div>
<p class="k" id="upd"></p>
<script>
var base=location.pathname.replace(/\\/$/,'');
function set(id,t){document.getElementById(id).textContent=t}
async function load(){
  try{
    var r=await fetch(base+'/data',{cache:'no-store'});
    if(!r.ok){set('who','Este link não está mais disponível.');return}
    var d=await r.json();
    set('who',(d.passenger||'Uma pessoa')+' compartilhou a corrida com você');
    set('status',d.statusText);
    set('driver',d.driver||'—');
    set('vehicle',d.vehicle?(d.vehicle.model+' · placa '+d.vehicle.plate):'—');
    set('from',d.pickup);set('to',d.dropoff);
    var pos=document.getElementById('pos');
    if(d.driverPosition){
      pos.textContent='';var a=document.createElement('a');
      a.href='https://www.google.com/maps?q='+encodeURIComponent(d.driverPosition.lat+','+d.driverPosition.lng);
      a.textContent='Ver no mapa';a.target='_blank';a.rel='noopener noreferrer';pos.appendChild(a);
    }else pos.textContent=d.ended?'Corrida encerrada':'Sem posição no momento';
    document.getElementById('alert').style.display=d.emergency?'block':'none';
    set('upd','Atualizado às '+new Date(d.updatedAt).toLocaleTimeString('pt-BR'));
    if(!d.ended)setTimeout(load,10000);
  }catch(e){set('who','Sem conexão. Tentando de novo…');setTimeout(load,10000)}
}
load();
</script></main></body></html>`;
