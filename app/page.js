'use client';
import {useEffect} from 'react';
export default function Page(){useEffect(()=>{window.location.replace('/legacy/index.html'+window.location.search+window.location.hash)},[]);return <div style={{minHeight:'100vh',display:'grid',placeItems:'center',fontFamily:'Arial',color:'#003E17'}}>Opening Halwani Food Service…</div>}
