pragma solidity 0.8.0;

import "./IERC20.sol";

interface IUniswapV2Router02 {
    function swapExactTokensForTokensSupportingFeeOnTransferTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external;
}

/**
 * @dev execute arbitrage opportunities
 * 
 * can only use WMATIC as the first token, all funds are kept in the contract 
 * and on doubleSwap it only checks if the swaps were profitable at the end.
 * 
 * the contract is unoptimized, for some reason if you set the minAmountOut
 * in the second swap to the amountIn, it throws a revert error. that must be looked into
 * 
 */
contract Arbitrage2 {
    address private admin;
    
    constructor() {
        admin = msg.sender;
    }
    
    modifier ensure(uint deadline) {
        require(deadline >= block.timestamp, 'ARB: EXPIRED');
        _;
    }
    
    modifier onlyAdmin() {
        require(msg.sender == admin, 'ARB: NOT OWNER');
        _;
    }

    function withdrawToken(uint _amount, address _token) external onlyAdmin() {
        IERC20(_token).transfer(msg.sender, _amount);
    }
    
    /**
     * @dev swap twice using two different routers
     * 
     * all funds are saved within the contract
     * 
     * if amount gotten is lower than initial WMATIC amount
     * transactions will revert
     * 
     */
    function doubleSwap(
            address _token0,
            address _token1,
            address _router0,
            address _router1,
            uint _amountIn,
            uint _amountOut,  // amount out in first swap
            uint _deadline
        ) onlyAdmin() ensure(_deadline) external {
        
        IERC20 _token0Interface = IERC20(_token0);
        uint _token0BalanceBeforeSwap = _token0Interface.balanceOf(address(this));
        require(_token0BalanceBeforeSwap >= _amountIn, "ARB: NOT ENOUGH TOKEN 0");
        
        _token0Interface.approve(_router0, _amountIn); // approve first router to use wmatic
        
        // first swap args
        address[] memory _path = new address[](2);
        _path[0] = _token0;
        _path[1] = _token1;
        
        // first swap
        IUniswapV2Router02(_router0).swapExactTokensForTokensSupportingFeeOnTransferTokens(
            _amountIn,
            _amountOut,
            _path,
            address(this),
            _deadline
        );
        
        uint _token1BalanceAfterSwap = IERC20(_token1).balanceOf(address(this));
        // approve all gotten tokens of type token
        IERC20(_token1).approve(_router1, _token1BalanceAfterSwap);

        // switch swap order
        _path[0] = _token1;
        _path[1] = _token0;
        
        // second swap
        IUniswapV2Router02(_router1).swapExactTokensForTokensSupportingFeeOnTransferTokens(
            _token1BalanceAfterSwap,
            _amountIn,
            _path,
            address(this),
            _deadline
        );
        
        // cancel if amount gotten is smaller than initial amountIn
        require(_token0Interface.balanceOf(address(this)) > _token0BalanceBeforeSwap, "ARB: FAILURE LOST MONEY");
    }
}