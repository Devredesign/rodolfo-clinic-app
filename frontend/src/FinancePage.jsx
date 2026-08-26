import React from'react'
import{Box,Card,CardContent,Stack,Typography}from'@mui/material'
import ExchangeRateControl from'./ExchangeRateControl.jsx'
import FinanceScreen from'./FinanceScreen.jsx'
export default function FinancePage(props){return <Stack spacing={3}><Card variant="outlined"><CardContent><Stack direction={{xs:'column',sm:'row'}} justifyContent="space-between" alignItems={{sm:'center'}} spacing={1}><Box><Typography fontWeight={800}>Tipo de cambio</Typography><Typography variant="body2" color="text.secondary">Valor vigente para nuevas conversiones CRC ↔ USD.</Typography></Box><ExchangeRateControl organization={props.organization} userId={props.userId} role={props.role} onUpdated={props.onOrganizationUpdated}/></Stack></CardContent></Card><FinanceScreen {...props}/></Stack>}
