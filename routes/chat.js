const express=require('express');const Conversation=require('../models/conversation');const router=express.Router();
router.post('/api/conversations',async(req,res)=>{if(!req.session.userId)return res.status(401).json({});const other=req.body.userId;if(!other||other===req.session.userId)return res.status(400).json({});let c=await Conversation.findOne({participants:{$all:[req.session.userId,other],$size:2}});if(!c)c=await Conversation.create({participants:[req.session.userId,other]});res.json({id:c._id});});
module.exports=router;
