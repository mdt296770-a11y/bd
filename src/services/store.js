const pool=require('../db/pool');
function buildWhere({activeOnly=true,search='',category=''}){const where=[],args=[];if(activeOnly)where.push('p.is_active=true');if(search){args.push(`%${search.replace(/[\\%_]/g,'\\$&')}%`);where.push(`(p.name ILIKE $${args.length} OR p.sku ILIKE $${args.length})`);}if(category){args.push(category);where.push(`c.slug=$${args.length}`);}return {where,args};}
async function countProducts(o={}){const {where,args}=buildWhere(o);const r=await pool.query(`SELECT COUNT(*)::int n FROM products p LEFT JOIN categories c ON c.id=p.category_id ${where.length?'WHERE '+where.join(' AND '):''}`,args);return r.rows[0].n;}
async function getProducts(o={}){const {sort='featured',limit=100,offset=0}=o;const {where,args}=buildWhere(o);const sorts={'price-asc':'p.price_paisa ASC','price-desc':'p.price_paisa DESC','newest':'p.created_at DESC','featured':'p.is_featured DESC,p.created_at DESC'};args.push(limit,offset);const sql=`SELECT p.*,c.name AS category_name,c.slug AS category_slug FROM products p LEFT JOIN categories c ON c.id=p.category_id ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY ${sorts[sort]||sorts.featured} LIMIT $${args.length-1} OFFSET $${args.length}`;return (await pool.query(sql,args)).rows;}
const fsp=require('node:fs/promises');const nodePath=require('node:path');
const UPLOAD_DIR=nodePath.resolve(__dirname,'../../uploads');
const DEFAULT_BANNERS=[['Own The Sun','Statement frames for every day.'],['Find Your Frame','A new look starts here.'],['Summer Mode On','Fresh styles, effortless confidence.'],['Everyday Icons','Your daily pair, upgraded.'],['Bold Looks Only','Stand out in every frame.'],['The Weekend Edit','Discover your next favourite.']];
const defaultBanner=i=>({id:-(i+1),title:DEFAULT_BANNERS[i%6][0],subtitle:DEFAULT_BANNERS[i%6][1],image_url:`/images/banners/banner-${(i%6)+1}.svg`,cta_label:'Shop Now',cta_url:'/shop'});
const UPLOAD_RE=/^\/uploads\/([a-f0-9]{32}\.(?:png|jpg|webp|gif))$/;
// Homepage banners come from the admin panel. If an uploaded image no longer exists (e.g. it was stored on a temporary
// disk that a redeploy wiped), show the bundled illustration instead of a blank hero; if there are no banners at all, show six defaults.
async function getBanners(){
  const rows=(await pool.query('SELECT * FROM banners WHERE is_active=true ORDER BY sort_order,id LIMIT 6')).rows;
  if(!rows.length) return DEFAULT_BANNERS.map((_,i)=>defaultBanner(i));
  const names=rows.map(r=>(UPLOAD_RE.exec(r.image_url||'')||[])[1]).filter(Boolean);
  const inDb=new Set(names.length?(await pool.query('SELECT name FROM uploaded_files WHERE name=ANY($1)',[names])).rows.map(r=>r.name):[]);
  return Promise.all(rows.map(async(r,i)=>{
    const m=(UPLOAD_RE.exec(r.image_url||'')||[])[1];
    if(!m||inDb.has(m)) return r;
    try{await fsp.access(nodePath.join(UPLOAD_DIR,m));return r;}catch{}
    const d=defaultBanner(i);
    return {...r,image_url:d.image_url,title:/^[\p{P}\p{S}\s]*$/u.test(r.title||'')?d.title:r.title,subtitle:r.subtitle||d.subtitle};
  }));
}
async function getCategories(){return (await pool.query('SELECT c.*,COUNT(p.id)::int AS product_count FROM categories c LEFT JOIN products p ON p.category_id=c.id AND p.is_active=true GROUP BY c.id ORDER BY c.name')).rows;}
module.exports={countProducts,getProducts,getBanners,getCategories};
