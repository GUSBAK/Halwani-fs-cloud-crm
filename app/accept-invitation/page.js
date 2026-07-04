'use client';
import {useEffect} from 'react';
export default function AcceptInvitation(){useEffect(()=>{const qs=new URLSearchParams(window.location.search);qs.set('invite','1');window.location.replace('/legacy/index.html?'+qs.toString()+window.location.hash)},[]);return <div style={{minHeight:'100vh',display:'grid',placeItems:'center',fontFamily:'Arial',color:'#003E17'}}>Opening password setup…</div>}
